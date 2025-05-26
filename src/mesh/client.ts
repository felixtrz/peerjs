import { util } from "../utils/utils";
import logger, { LogLevel } from "../utils/logger";
import type { DataConnection } from "../connection/data-connection";
import { RemoteNode } from "./node";
import { ServerManager } from "./server-manager";
import { NetworkManager } from "./network-manager";
import {
	MeshClientErrorType,
	ServerMessageType,
} from "../utils/enums";
import type { ServerMessage } from "../server/server-message";
import type { MeshClientConnectOption, MeshClientJSOption } from "../options";
import { BinaryPack } from "../connection/buffered-connection/binary-pack";
import { Raw } from "../connection/buffered-connection/raw";
import { Json } from "../connection/buffered-connection/json";

import { EventEmitterWithError, MeshClientError } from "../utils/error";

export interface MeshClientOptions extends MeshClientJSOption {
	/**
	 * Prints log messages depending on the debug level passed in.
	 */
	debug?: LogLevel;
	pingInterval?: number;
	logFunction?: (logLevel: LogLevel, ...rest: any[]) => void;
	serializers?: SerializerMapping;
}

/**
 * @internal
 */
export interface SerializerMapping {
	[key: string]: new (
		peerId: string,
		provider: MeshClient,
		node: RemoteNode,
		options: any,
	) => DataConnection;
}

export interface MeshClientEvents {
	/**
	 * Emitted when a connection to the PeerServer is established.
	 *
	 * You may use the peer before this is emitted, but messages to the server will be queued. <code>id</code> is the brokering ID of the peer (which was either provided in the constructor or assigned by the server).<span class='tip'>You should not wait for this event before connecting to other peers if connection speed is important.</span>
	 */
	open: (id: string) => void;
	/**
	 * Emitted when a new node is established from a remote peer.
	 */
	connection: (node: RemoteNode) => void;
	/**
	 * Emitted when the peer is destroyed and can no longer accept or create any new connections.
	 */
	close: () => void;
	/**
	 * Emitted when the peer is disconnected from the signalling server
	 */
	disconnected: (currentId: string) => void;
	/**
	 * Errors on the peer are almost always fatal and will destroy the peer.
	 *
	 * Errors from the underlying socket and PeerConnections are forwarded here.
	 */
	error: (error: MeshClientError<`${MeshClientErrorType}`>) => void;
}

/**
 * A peer who can initiate connections with other peers.
 */
export class MeshClient extends EventEmitterWithError<
	MeshClientErrorType,
	MeshClientEvents
> {
	private static readonly DEFAULT_KEY = "peerjs";

	protected readonly _serializers: SerializerMapping = {
		raw: Raw,
		json: Json,
		binary: BinaryPack,
		"binary-utf8": BinaryPack,
	};

	private readonly _options: MeshClientOptions;
	private readonly _serverManager: ServerManager;
	private readonly _networkManager: NetworkManager;
	private readonly _remoteNodes: Map<string, RemoteNode> = new Map();
	private readonly _lostMessages: Map<string, ServerMessage[]> = new Map();
	private readonly _connectionAttempts: Set<string> = new Set();

	private _destroyed = false; // Connections cannot be made after this is set true.
	private _disconnected = false; // Connection to PeerServer killed but P2P connections still active.

	get id(): string | null {
		return this._serverManager.id;
	}

	get options(): MeshClientOptions {
		return this._options;
	}

	get open(): boolean {
		return this._serverManager.open;
	}

	/**
	 * Whether the peer is disconnected from the server.
	 */
	get disconnected(): boolean {
		return this._disconnected;
	}

	get destroyed(): boolean {
		return this._destroyed;
	}

	get socket() {
		return this._serverManager.socket;
	}

	constructor(id?: string | Partial<MeshClientOptions>, options?: Partial<MeshClientOptions>) {
		super();

		let peerId: string | undefined;
		let opts: Partial<MeshClientOptions>;

		// Handle overloaded constructor
		if (typeof id === "string") {
			peerId = id;
			opts = options || {};
		} else {
			peerId = undefined;
			opts = id || {};
		}

		// Set up options
		this._options = {
			debug: LogLevel.Disabled,
			host: util.CLOUD_HOST,
			port: util.CLOUD_PORT,
			path: "/",
			key: MeshClient.DEFAULT_KEY,
			token: util.randomToken(),
			config: util.defaultConfig,
			secure: util.isSecure(),
			pingInterval: 5000,
			...opts,
		};
		
		// Special handling for host "/"
		if (this._options.host === "/") {
			this._options.host = window.location.hostname;
		}
		
		// Ensure path starts and ends with "/"
		if (this._options.path && this._options.path[0] !== "/") {
			this._options.path = "/" + this._options.path;
		}
		if (this._options.path && this._options.path[this._options.path.length - 1] !== "/") {
			this._options.path += "/";
		}

		// Set logger function if provided
		if (this._options.logFunction) {
			logger.setLogFunction(this._options.logFunction);
		}

		// Set debug level
		logger.logLevel = this._options.debug!;

		// Override serializers if provided
		if (this._options.serializers) {
			Object.assign(this._serializers, this._options.serializers);
		}

		// Initialize server and network managers
		this._serverManager = new ServerManager(this._options);
		this._networkManager = new NetworkManager();

		// Set up server manager events
		this._setupServerManagerEvents();
		this._setupNetworkManagerEvents();

		// Start connection (with or without ID)
		this._serverManager.connect(peerId);
	}

	/**
	 * Connect to another peer by ID
	 */
	connect(peer: string, options?: MeshClientConnectOption): RemoteNode | undefined {
		if (this._disconnected) {
			logger.warn(
				"You cannot connect to a new peer because you called " +
					".disconnect() on this peer and ended your connection with the server.",
			);
			this.emitError(MeshClientErrorType.Disconnected, "Cannot connect to new peer after disconnecting from server");
			return undefined;
		}

		if (this._destroyed) {
			throw new Error("This peer is destroyed and cannot make connections");
		}

		// Prevent duplicate connections
		if (this._connectionAttempts.has(peer)) {
			logger.warn(`Connection attempt to ${peer} already in progress`);
			return this._remoteNodes.get(peer)!;
		}

		this._connectionAttempts.add(peer);

		peer = peer.toString();

		// Return existing node if it exists and is open
		const existingNode = this._remoteNodes.get(peer);
		if (existingNode) {
			if (existingNode.open) {
				logger.warn(`Already connected to ${peer}`);
				this._connectionAttempts.delete(peer);
				return existingNode;
			}
		} else {
			// Create new node
			const node = new RemoteNode(peer, this, options?.metadata);
			this._remoteNodes.set(peer, node);
			this._networkManager.addNode(node);
		}

		const node = this._remoteNodes.get(peer)!;

		node.on("open", () => {
			this._connectionAttempts.delete(peer);
			this._networkManager.handleMeshNetworking(node);
			this.emit("connection", node);
		});

		node.on("close", () => {
			this._connectionAttempts.delete(peer);
			this._cleanupPeer(peer);
		});

		this._startConnection(node, options || {});

		return node;
	}

	/**
	 * Broadcast data to all connected peers
	 */
	broadcast(data: any, options?: { reliable?: boolean }): number {
		return this._networkManager.broadcast(data, options);
	}

	/**
	 * Disconnect from the server (but keep existing connections)
	 */
	disconnect(): void {
		if (this._disconnected) {
			return;
		}

		const currentId = this.id;
		logger.log(`Disconnect peer with ID: ${currentId}`);

		this._disconnected = true;
		this._serverManager.disconnect();

		if (currentId) {
			this.emit("disconnected", currentId);
		}
	}

	/**
	 * Close and destroy the peer
	 */
	destroy(): void {
		if (this._destroyed) {
			return;
		}

		logger.log(`Destroying peer with ID: ${this.id}`);
		this.disconnect();
		this._cleanup();
		this._destroyed = true;
		this.emit("close");
	}

	/**
	 * Get a remote node by peer ID
	 */
	getNode(peerId: string): RemoteNode | undefined {
		return this._remoteNodes.get(peerId);
	}

	/**
	 * Get all connected peer IDs
	 */
	getConnectedPeerIds(): string[] {
		return this._networkManager.getConnectedPeerIds();
	}

	/**
	 * Reconnect to the server (for backward compatibility)
	 */
	reconnect(): void {
		if (this._destroyed) {
			throw new Error("This peer cannot reconnect to the server. It has already been destroyed.");
		}
		if (!this._disconnected) {
			throw new Error("Cannot reconnect to server - peer is not disconnected");
		}
		this._disconnected = false;
		this._serverManager.connect(this.id || undefined);
	}

	/**
	 * Get queued messages for a peer (for testing)
	 * @internal
	 */
	_getMessages(peerId: string): ServerMessage[] {
		const messages = this._lostMessages.get(peerId) || [];
		// Clear messages after retrieval (they should only be delivered once)
		this._lostMessages.delete(peerId);
		return messages;
	}

	/**
	 * Clean up lost messages for a specific peer (for testing)
	 * @internal
	 */
	_cleanupLostMessages(peerId: string): void {
		this._lostMessages.delete(peerId);
	}

	/**
	 * Remove a node (for testing)
	 * @internal
	 */
	_removeNode(peerId: string): void {
		this._cleanupPeer(peerId);
	}

	/**
	 * Get mesh handshakes (for testing)
	 * @internal
	 */
	get _meshHandshakes() {
		return (this._networkManager as any)._meshHandshakes;
	}

	/**
	 * Send mesh handshake (for testing)
	 * @internal
	 */
	_sendMeshHandshake(node: RemoteNode): void {
		return (this._networkManager as any)._sendMeshHandshake(node);
	}

	/**
	 * Handle mesh networking for a node (for testing)
	 * @internal
	 */
	_handleMeshNetworking(node: RemoteNode): void {
		return this._networkManager.handleMeshNetworking(node);
	}

	/**
	 * Get connected peer IDs (for testing)
	 * @internal
	 */
	_getConnectedPeerIds(): string[] {
		return this._networkManager.getConnectedPeerIds();
	}


	private _setupServerManagerEvents(): void {
		this._serverManager.on("open", (id: string) => {
			this.emit("open", id);
		});

		this._serverManager.on("message", (message: ServerMessage) => {
			this._handleMessage(message);
		});

		this._serverManager.on("error", (type: MeshClientErrorType, error: string | Error) => {
			this._abort(type, error);
		});

		this._serverManager.on("disconnect", () => {
			if (this._disconnected) {
				return;
			}
			this.emitError(MeshClientErrorType.Network, "Lost connection to server.");
			this.disconnect();
		});

		this._serverManager.on("close", () => {
			if (this._disconnected) {
				return;
			}
			this._abort(
				MeshClientErrorType.SocketClosed,
				"Underlying socket is already closed.",
			);
		});
	}

	private _setupNetworkManagerEvents(): void {
		this._networkManager.on("connect-to-peers", (peerIds: string[]) => {
			this._connectToMeshPeers(peerIds);
		});
	}

	/** @internal */
	_handleMessage(message: ServerMessage): void {
		const type = message.type;
		const src = message.src;

		switch (type) {
			case ServerMessageType.Open:
			case ServerMessageType.Error:
			case ServerMessageType.IdTaken:
			case ServerMessageType.InvalidKey:
				// These message types are handled by ServerManager
				this._serverManager._handleMessage(message);
				break;
				
			case ServerMessageType.Expire:
				// Handle expire: remove the expired peer connection and emit error
				if (src) {
					this.emitError(MeshClientErrorType.PeerUnavailable, `Could not connect to peer ${src}`);
					this._cleanupPeer(src);
				}
				break;
				
			case ServerMessageType.Leave:
				// Handle leave: remove the peer that left
				if (src) {
					this._cleanupPeer(src);
				}
				break;
			case ServerMessageType.Offer:
			case ServerMessageType.Answer:
			case ServerMessageType.Candidate:
				const node = this._getNode(src);
				if (node) {
					// Find the connection and pass the message to it
					const connections = (node as any)._connections;
					if (connections && connections.length > 0) {
						connections[0].handleMessage(message);
					}
				} else {
					this._storeMessage(src, message);
				}
				break;

			case ServerMessageType.Leave:
				logger.log(`Received leave message from ${src}`);
				this._cleanupPeer(src);
				break;

			case ServerMessageType.Expire:
				this.emitError(MeshClientErrorType.PeerUnavailable, `Could not connect to peer ${src}`);
				break;

			default:
				logger.warn("Unrecognized message type:", type, "from peer:", src);
				break;
		}
	}

	private _startConnection(node: RemoteNode, options: MeshClientConnectOption): void {
		const dataConnection = this._createDataConnection(node, options);
		node._addConnection(dataConnection);

		// Check for lost messages
		const messages = this._lostMessages.get(node.peer);
		if (messages) {
			for (const message of messages) {
				dataConnection.handleMessage(message);
			}
			this._lostMessages.delete(node.peer);
		}

		// Connection starts automatically in constructor
	}

	_createDataConnection(node: RemoteNode, options: MeshClientConnectOption): DataConnection {
		const serialization = options.serialization || "binary";
		const SerializerClass = this._serializers[serialization];
		
		if (!SerializerClass) {
			throw new Error(`No serializer found for ${serialization}`);
		}

		return new SerializerClass(node.peer, this, node, {
			...options,
			connectionId: util.randomToken(),
			originator: true,
			reliable: options.reliable ?? true,
		});
	}

	private _getNode(peerId: string): RemoteNode | undefined {
		return this._remoteNodes.get(peerId);
	}

	private _storeMessage(peerId: string, message: ServerMessage): void {
		if (!this._lostMessages.has(peerId)) {
			this._lostMessages.set(peerId, []);
		}
		this._lostMessages.get(peerId)!.push(message);
	}

	private _connectToMeshPeers(peerIds: string[]): void {
		for (const peerId of peerIds) {
			if (
				peerId !== this.id &&
				!this._remoteNodes.has(peerId) &&
				!this._connectionAttempts.has(peerId)
			) {
				logger.log(`Connecting to mesh peer ${peerId}`);
				try {
					this.connect(peerId);
				} catch (error) {
					logger.warn(`Failed to connect to mesh peer ${peerId}:`, error);
				}
			}
		}
	}

	/**
	 * Delayed abort (for testing)
	 * @internal
	 */
	_delayedAbort(type: MeshClientErrorType, message: string | Error): void {
		setTimeout(() => {
			this._abort(type, message);
		}, 0);
	}

	private _abort(type: MeshClientErrorType, message: string | Error): void {
		logger.error("Aborting:", message);
		
		// If we have a server ID, just disconnect; otherwise destroy
		if ((this as any)._lastServerId) {
			this._disconnected = true;
		} else {
			this._destroyed = true;
		}
		
		this.emitError(type, message);
		
		if (this._destroyed) {
			this.destroy();
		}
	}

	private _cleanup(): void {
		for (const node of this._remoteNodes.values()) {
			node.close();
		}
		this._remoteNodes.clear();
		this._lostMessages.clear();
		this._connectionAttempts.clear();
		this._networkManager.cleanup();
	}

	private _cleanupPeer(peerId: string): void {
		const node = this._remoteNodes.get(peerId);
		if (node && !node.destroyed) {
			node.close();
		}
		this._remoteNodes.delete(peerId);
		this._lostMessages.delete(peerId);
		this._connectionAttempts.delete(peerId);
		this._networkManager.removeNode(peerId);
	}
}