import { EventEmitterWithError, type EventsWithError } from "./p2p/mesh-client-error";
import type { DataConnection } from "./p2p/data-connection";
import type { MeshClient } from "./mesh-client";
import type { ServerMessage } from "./server/server-message";
import logger from "./utils/logger";

export interface RemoteNodeEvents extends EventsWithError<string> {
	/**
	 * Emitted when data is received from the remote peer.
	 */
	data: (data: unknown) => void;
	/**
	 * Emitted when the node is established and ready-to-use.
	 */
	open: () => void;
	/**
	 * Emitted when the node is closed.
	 */
	close: () => void;
	/**
	 * Emitted when an error occurs.
	 */
	error: (error: Error) => void;
	/**
	 * Emitted when the ping value is updated.
	 */
	ping: (latency: number) => void;
}

/**
 * Represents a remote client (peer) and manages all connections to it.
 */
export class RemoteNode extends EventEmitterWithError<string, RemoteNodeEvents> {
	private _connections: DataConnection[] = [];
	private _open = false;
	private _destroyed = false;
	private _lostMessages: Map<string, ServerMessage[]> = new Map(); // connectionId => [list of messages]
	private _ping: number | null = null;
	private _pingInterval: ReturnType<typeof setInterval> | null = null;

	/**
	 * The ID of the remote peer.
	 */
	readonly peer: string;

	/**
	 * Any type of metadata associated with the node,
	 * passed in by whoever initiated the connection.
	 */
	readonly metadata: any;

	/**
	 * Whether the node is active (e.g. open and ready for messages).
	 */
	get open() {
		return this._open;
	}

	/**
	 * Whether the node has been destroyed.
	 */
	get destroyed() {
		return this._destroyed;
	}

	/**
	 * The number of active connections to this node.
	 */
	get connectionCount() {
		return this._connections.length;
	}

	/**
	 * The current ping latency in milliseconds to this node.
	 * Returns null if no ping data is available.
	 */
	get ping() {
		return this._ping;
	}

	constructor(
		peer: string,
		private provider: MeshClient,
		metadata?: any,
	) {
		super();
		this.peer = peer;
		this.metadata = metadata;
	}

	/**
	 * Adds a connection to this node and sets up event handlers.
	 * @internal
	 */
	_addConnection(connection: DataConnection): void {
		if (this._destroyed) {
			logger.warn(`Attempted to add connection to destroyed node ${this.peer}`);
			connection.close();
			return;
		}

		// Check if this connection already exists
		const existingConnection = this._connections.find(
			(conn) => conn.connectionId === connection.connectionId,
		);
		if (existingConnection) {
			logger.log(
				`Connection ${connection.connectionId} already exists in node ${this.peer}`,
			);
			return;
		}

		this._connections.push(connection);

		// Set up event handlers for this connection
		connection.on("data", (data) => {
			// Filter out internal mesh networking messages
			if (this._isInternalMeshMessage(data)) {
				this._handleInternalMeshMessage(data);
				return;
			}
			this.emit("data", data);
		});

		connection.on("open", () => {
			this._checkIfReady();
			this._deduplicateConnections();
		});

		connection.on("close", () => {
			this._removeConnection(connection);
		});

		connection.on("error", (error) => {
			this.emit("error", error);
		});

		// Handle lost messages for this connection
		const messages = this._getMessages(connection.connectionId);
		for (const message of messages) {
			connection.handleMessage(message);
		}

		// If connection is already open, check if node should be ready
		if (connection.open) {
			this._checkIfReady();
			this._deduplicateConnections();
		}
	}

	/**
	 * Removes a connection from this node.
	 * @internal
	 */
	_removeConnection(connection: DataConnection): void {
		const index = this._connections.indexOf(connection);
		if (index !== -1) {
			this._connections.splice(index, 1);
		}

		// Clean up lost messages for this connection
		this._cleanupLostMessages(connection.connectionId);

		// If no more connections, close the node
		if (this._connections.length === 0 && !this._destroyed) {
			this.close();
		}
	}

	/**
	 * Checks if the node should be marked as ready.
	 * @internal
	 */
	private _checkIfReady(): void {
		if (!this._open && this._connections.some((conn) => conn.open)) {
			this._open = true;
			this.emit("open");
			this._startPingMonitoring();
		}
	}

	/**
	 * Deduplicates connections when multiple connections exist.
	 * The peer with the larger ID closes extra connections.
	 * @internal
	 */
	private _deduplicateConnections(): void {
		// Only deduplicate if we have multiple open connections
		const openConnections = this._connections.filter((conn) => conn.open);
		if (openConnections.length <= 1) {
			return;
		}

		// The peer with the bigger ID closes extra connections
		const myId = this.provider.id;
		const shouldIClose = myId && myId > this.peer;

		if (shouldIClose) {
			// Wait a bit before deduplicating to allow messages to be received
			setTimeout(() => {
				// Re-check in case connections have changed
				const currentOpenConnections = this._connections.filter(
					(conn) => conn.open,
				);
				if (currentOpenConnections.length <= 1) {
					return;
				}

				logger.log(
					`Deduplicating connections for node ${this.peer}. Keeping one, closing ${currentOpenConnections.length - 1}`,
				);

				// Sort connections by connectionId to ensure both peers keep the same one
				currentOpenConnections.sort((a, b) =>
					a.connectionId.localeCompare(b.connectionId),
				);

				// Keep the first connection, close the rest
				for (let i = 1; i < currentOpenConnections.length; i++) {
					currentOpenConnections[i].close();
				}
			}, 100); // Small delay to allow pending messages to be received
		}
	}

	/**
	 * Sends data to the remote peer using the first available connection.
	 */
	send(data: any): void {
		if (!this._open) {
			this.emitError(
				"NotOpenYet",
				"Node is not open. You should listen for the `open` event before sending messages.",
			);
			return;
		}

		const openConnection = this._connections.find((conn) => conn.open);
		if (!openConnection) {
			this.emitError(
				"NoOpenConnection",
				"No open connections available to send data.",
			);
			return;
		}

		openConnection.send(data);
	}

	/**
	 * Closes all connections to the remote peer and destroys the node.
	 */
	close(): void {
		if (this._destroyed) {
			return;
		}

		this._destroyed = true;
		this._open = false;
		this._stopPingMonitoring();

		// Close all connections
		const connections = [...this._connections];
		for (const connection of connections) {
			connection.close();
		}
		this._connections = [];

		// Remove from provider
		if (this.provider) {
			this.provider._removeNode(this);
		}

		this.emit("close");
	}

	/**
	 * Retrieve a data connection by connectionId.
	 * @internal
	 */
	getConnection(connectionId: string): DataConnection | null {
		for (const connection of this._connections) {
			if (connection.connectionId === connectionId) {
				return connection;
			}
		}
		return null;
	}

	/**
	 * Stores messages without a set up connection, to be claimed later.
	 * @internal
	 */
	_storeMessage(connectionId: string, message: ServerMessage): void {
		if (!this._lostMessages.has(connectionId)) {
			this._lostMessages.set(connectionId, []);
		}
		this._lostMessages.get(connectionId)!.push(message);
	}

	/**
	 * Retrieve messages from lost message store and clear them.
	 * @internal
	 */
	_getMessages(connectionId: string): ServerMessage[] {
		const messages = this._lostMessages.get(connectionId);
		if (messages) {
			this._lostMessages.delete(connectionId);
			return messages;
		}
		return [];
	}

	/**
	 * Clean up lost messages for a connection.
	 * @internal
	 */
	_cleanupLostMessages(connectionId: string): void {
		this._lostMessages.delete(connectionId);
	}

	/**
	 * Check if a message is an internal mesh networking message
	 * @internal
	 */
	private _isInternalMeshMessage(data: any): boolean {
		return data && 
			typeof data === "object" && 
			data.__peerJSInternal === true &&
			(data.type === "mesh-peers" || data.type === "mesh-peers-ack");
	}

	/**
	 * Handle internal mesh networking messages
	 * @internal
	 */
	private _handleInternalMeshMessage(data: any): void {
		// Emit a special internal event that MeshClient can listen to
		this.emit("_internal_mesh_message" as any, data);
	}

	/**
	 * Alias for close().
	 */
	disconnect(): void {
		this.close();
	}

	/**
	 * Starts monitoring ping/latency to the remote node.
	 * @internal
	 */
	private _startPingMonitoring(): void {
		if (this._pingInterval) {
			return;
		}

		// Initial ping measurement
		this._measurePing();

		// Set up periodic ping measurements (every 5 seconds)
		this._pingInterval = globalThis.setInterval(() => {
			if (this._open && !this._destroyed) {
				this._measurePing();
			}
		}, 5000);
	}

	/**
	 * Stops monitoring ping/latency.
	 * @internal
	 */
	private _stopPingMonitoring(): void {
		if (this._pingInterval) {
			globalThis.clearInterval(this._pingInterval);
			this._pingInterval = null;
		}
	}

	/**
	 * Measures the current ping/latency to the remote node.
	 * @internal
	 */
	private async _measurePing(): Promise<void> {
		const openConnection = this._connections.find((conn) => conn.open && conn.peerConnection);
		if (!openConnection || !openConnection.peerConnection) {
			return;
		}

		try {
			const stats = await openConnection.peerConnection.getStats();
			let totalRtt = 0;
			let rttCount = 0;

			stats.forEach((report) => {
				// Look for candidate-pair stats which contain RTT
				if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime) {
					totalRtt += report.currentRoundTripTime * 1000; // Convert to milliseconds
					rttCount++;
				}
			});

			if (rttCount > 0) {
				const avgRtt = Math.round(totalRtt / rttCount);
				this._ping = avgRtt;
				this.emit('ping', avgRtt);
				logger.log(`Ping to ${this.peer}: ${avgRtt}ms`);
			}
		} catch (error) {
			logger.error(`Failed to measure ping for ${this.peer}:`, error);
		}
	}
}
