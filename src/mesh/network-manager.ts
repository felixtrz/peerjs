import { EventEmitter } from "events";
import type { RemoteNode } from "./node";
import logger from "../utils/logger";

interface MeshHandshakeInfo {
	timestamp: number;
	retryCount: number;
	timeoutId?: NodeJS.Timeout;
}

export interface NetworkManagerEvents {
	"connect-to-peers": (peerIds: string[]) => void;
}

/**
 * Manages mesh networking functionality including peer discovery and handshakes
 */
export class NetworkManager extends EventEmitter {
	private readonly _meshHandshakes: Map<string, MeshHandshakeInfo> = new Map();
	private readonly _connectedNodes: Map<string, RemoteNode> = new Map();

	/**
	 * Set up mesh networking for a remote node
	 */
	handleMeshNetworking(node: RemoteNode): void {
		// Initialize handshake tracking
		const handshakeInfo: MeshHandshakeInfo = {
			timestamp: Date.now(),
			retryCount: 0,
		};
		this._meshHandshakes.set(node.peer, handshakeInfo);

		// Set up event handlers
		node.on("open", () => {
			this._sendMeshHandshake(node);
		});

		(node as any).on("_internal_mesh_message", (data: any) => {
			switch (data.type) {
				case "mesh-peers":
					this._handleMeshPeers(node, data);
					break;
				case "mesh-peers-ack":
					this._handleMeshAck(node, data);
					break;
			}
		});

		node.on("close", () => {
			const handshake = this._meshHandshakes.get(node.peer);
			if (handshake?.timeoutId) {
				clearTimeout(handshake.timeoutId);
			}
			this._meshHandshakes.delete(node.peer);
		});
	}

	/**
	 * Add a connected node to the mesh
	 */
	addNode(node: RemoteNode): void {
		this._connectedNodes.set(node.peer, node);
	}

	/**
	 * Remove a node from the mesh
	 */
	removeNode(peerId: string): void {
		this._connectedNodes.delete(peerId);
		
		const handshake = this._meshHandshakes.get(peerId);
		if (handshake?.timeoutId) {
			clearTimeout(handshake.timeoutId);
		}
		this._meshHandshakes.delete(peerId);
	}

	/**
	 * Get list of connected peer IDs
	 */
	getConnectedPeerIds(): string[] {
		return Array.from(this._connectedNodes.keys()).filter(peerId => {
			const node = this._connectedNodes.get(peerId);
			return node && node.open;
		});
	}

	/**
	 * Broadcast data to all connected nodes
	 */
	broadcast(data: any, options?: { reliable?: boolean }): number {
		const connectedPeers = this.getConnectedPeerIds();
		let sentCount = 0;

		for (const peerId of connectedPeers) {
			const node = this._connectedNodes.get(peerId);
			if (node && node.open) {
				try {
					node.send(data, options);
					sentCount++;
				} catch (error) {
					logger.warn(`Failed to send broadcast to ${peerId}:`, error);
				}
			}
		}

		logger.log(`Broadcast sent to ${sentCount}/${connectedPeers.length} peers`);
		return sentCount;
	}

	/**
	 * Clean up all mesh connections
	 */
	cleanup(): void {
		// Clear all handshake timeouts
		for (const [, handshake] of this._meshHandshakes) {
			if (handshake.timeoutId) {
				clearTimeout(handshake.timeoutId);
			}
		}
		this._meshHandshakes.clear();
		this._connectedNodes.clear();
	}

	private _sendMeshHandshake(node: RemoteNode): void {
		const handshake = this._meshHandshakes.get(node.peer);
		if (!handshake) {
			return;
		}

		try {
			const myPeers = this.getConnectedPeerIds().filter(id => id !== node.peer);
			
			const message = {
				__peerJSInternal: true,
				type: "mesh-peers",
				peers: myPeers,
				timestamp: Date.now(),
				requiresAck: true,
			};

			node.send(message, { reliable: true });
			
			logger.log(
				`Sent mesh handshake to ${node.peer} with ${myPeers.length} peers`,
			);

			// Set up retry timeout
			handshake.timeoutId = setTimeout(() => {
				const currentHandshake = this._meshHandshakes.get(node.peer);
				if (currentHandshake && currentHandshake.retryCount < 3) {
					currentHandshake.retryCount++;
					logger.log(
						`Retrying mesh handshake to ${node.peer} (attempt ${currentHandshake.retryCount})`,
					);
					this._sendMeshHandshake(node);
				} else {
					logger.warn(`Mesh handshake to ${node.peer} failed after 3 attempts`);
					this._meshHandshakes.delete(node.peer);
				}
			}, 1000 * handshake.retryCount + 1000); // Exponential backoff starting at 1s

		} catch (error) {
			logger.warn(`Failed to send mesh handshake to ${node.peer}:`, error);
		}
	}

	/** Handle incoming mesh peers message */
	private _handleMeshPeers(node: RemoteNode, data: any): void {
		const handshake = this._meshHandshakes.get(node.peer);
		
		// Send acknowledgment if required
		if (data.requiresAck) {
			try {
				node.send(
					{
						__peerJSInternal: true,
						type: "mesh-peers-ack",
						timestamp: data.timestamp,
					},
					{ reliable: true },
				);
				logger.log(`Sent mesh-peers-ack to ${node.peer}`);
			} catch (error) {
				logger.warn(`Failed to send mesh-peers-ack to ${node.peer}:`, error);
			}
		}

		// Process peer list
		if (Array.isArray(data.peers)) {
			const peerList = data.peers.filter((peerId: string) => 
				typeof peerId === "string" && peerId.length > 0
			);
			this.emit("connect-to-peers", peerList);
		}

		// Clear handshake timeout if this was the initial handshake
		if (handshake?.timeoutId) {
			clearTimeout(handshake.timeoutId);
			handshake.timeoutId = undefined;
		}
	}

	private _handleMeshAck(node: RemoteNode, _data: any): void {
		const handshake = this._meshHandshakes.get(node.peer);
		if (!handshake) {
			return;
		}

		// Clear the retry timeout since we got an ack
		if (handshake.timeoutId) {
			clearTimeout(handshake.timeoutId);
			handshake.timeoutId = undefined;
		}

		logger.log(`Received mesh-peers-ack from ${node.peer}`);
	}
}