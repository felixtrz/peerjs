import { util } from "./utils/utils";
import logger, { LogLevel } from "./utils/logger";
import { Socket } from "./server/socket";
import type { DataConnection } from "./p2p/data-connection";
import { RemoteNode } from "./remote-node";
import {
	ConnectionType,
	MeshClientErrorType,
	ServerMessageType,
	SocketEventType,
} from "./utils/enums";
import type { ServerMessage } from "./server/server-message";
import { API } from "./server/api";
import type { MeshClientConnectOption, MeshClientJSOption } from "./options";
import { BinaryPack } from "./p2p/buffered-connection/binary-pack";
import { Raw } from "./p2p/buffered-connection/raw";
import { Json } from "./p2p/buffered-connection/json";

import {
	EventEmitterWithError,
	MeshClientError,
} from "./p2p/mesh-client-error";

class MeshClientOptions implements MeshClientJSOption {
	/**
	 * Prints log messages depending on the debug level passed in.
	 */
	debug?: LogLevel;
	/**
	 * Server host. Defaults to `0.peerjs.com`.
	 * Also accepts `'/'` to signify relative hostname.
	 */
	host?: string;
	/**
	 * Server port. Defaults to `443`.
	 */
	port?: number;
	/**
	 * The path where your self-hosted PeerServer is running. Defaults to `'/'`
	 */
	path?: string;
	/**
	 * API key for the PeerServer.
	 * This is not used anymore.
	 * @deprecated
	 */
	key?: string;
	token?: string;
	/**
	 * Configuration hash passed to RTCPeerConnection.
	 * This hash contains any custom ICE/TURN server configuration.
	 *
	 * Defaults to {@apilink util.defaultConfig}
	 */
	config?: any;
	/**
	 * Set to true `true` if you're using TLS.
	 * :::danger
	 * If possible *always use TLS*
	 * :::
	 */
	secure?: boolean;
	pingInterval?: number;
	referrerPolicy?: ReferrerPolicy;
	logFunction?: (logLevel: LogLevel, ...rest: any[]) => void;
	serializers?: SerializerMapping;
}

export { type MeshClientOptions };

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

		default: BinaryPack,
	};
	private readonly _options: MeshClientOptions;
	private readonly _api: API;
	private readonly _socket: Socket;

	private _id: string | null = null;
	private _lastServerId: string | null = null;

	// States.
	private _destroyed = false; // Connections have been killed
	private _disconnected = false; // Connection to PeerServer killed but P2P connections still active
	private _open = false; // Sockets and such are not yet open.
	private readonly _remoteNodes: Map<string, RemoteNode> = new Map(); // All nodes for this peer.
	private readonly _lostMessages: Map<string, ServerMessage[]> = new Map(); // src => [list of messages]

	// Mesh networking
	private readonly _connectionAttempts: Set<string> = new Set(); // Track connection attempts to prevent duplicates
	private readonly _meshHandshakes: Map<
		string,
		{ sent: boolean; received: boolean; retryCount: number; retryTimeout?: any }
	> = new Map(); // Track mesh handshakes
	private static readonly MESH_HANDSHAKE_MAX_RETRIES = 3;
	private static readonly MESH_HANDSHAKE_RETRY_DELAY = 1000; // 1 second
	/**
	 * The brokering ID of this peer
	 *
	 * If no ID was specified in {@apilink Peer | the constructor},
	 * this will be `undefined` until the {@apilink PeerEvents | `open`} event is emitted.
	 */
	get id() {
		return this._id;
	}

	get options() {
		return this._options;
	}

	get open() {
		return this._open;
	}

	/**
	 * @internal
	 */
	get socket() {
		return this._socket;
	}

	/**
	 * A hash of all nodes associated with this peer, keyed by the remote peer's ID.
	 */
	get nodes(): Object {
		const plainNodes = Object.create(null);

		for (const [k, v] of this._remoteNodes) {
			plainNodes[k] = v;
		}

		return plainNodes;
	}

	/**
	 * true if this peer and all of its connections can no longer be used.
	 */
	get destroyed() {
		return this._destroyed;
	}
	/**
	 * false if there is an active connection to the PeerServer.
	 */
	get disconnected() {
		return this._disconnected;
	}

	/**
	 * A peer can connect to other peers and listen for connections.
	 */
	constructor();

	/**
	 * A peer can connect to other peers and listen for connections.
	 * @param options for specifying details about PeerServer
	 */
	constructor(options: MeshClientOptions);

	/**
	 * A peer can connect to other peers and listen for connections.
	 * @param id Other peers can connect to this peer using the provided ID.
	 *     If no ID is given, one will be generated by the brokering server.
	 * The ID must start and end with an alphanumeric character (lower or upper case character or a digit). In the middle of the ID spaces, dashes (-) and underscores (_) are allowed. Use {@apilink MeshClientOptions.metadata } to send identifying information.
	 * @param options for specifying details about PeerServer
	 */
	constructor(id: string, options?: MeshClientOptions);

	constructor(id?: string | MeshClientOptions, options?: MeshClientOptions) {
		super();

		let userId: string | undefined;

		// Deal with overloading
		if (id && id.constructor == Object) {
			options = id as MeshClientOptions;
		} else if (id) {
			userId = id.toString();
		}

		// Configurize options
		options = {
			debug: 0, // 1: Errors, 2: Warnings, 3: All logs
			host: util.CLOUD_HOST,
			port: util.CLOUD_PORT,
			path: "/",
			key: MeshClient.DEFAULT_KEY,
			token: util.randomToken(),
			config: util.defaultConfig,
			referrerPolicy: "strict-origin-when-cross-origin",
			serializers: {},
			...options,
		};
		this._options = options;
		this._serializers = { ...this._serializers, ...this.options.serializers };

		// Detect relative URL host.
		if (this._options.host === "/") {
			this._options.host = window.location.hostname;
		}

		// Set path correctly.
		if (this._options.path) {
			if (this._options.path[0] !== "/") {
				this._options.path = "/" + this._options.path;
			}
			if (this._options.path[this._options.path.length - 1] !== "/") {
				this._options.path += "/";
			}
		}

		// Set whether we use SSL to same as current host
		if (
			this._options.secure === undefined &&
			this._options.host !== util.CLOUD_HOST
		) {
			this._options.secure = util.isSecure();
		} else if (this._options.host == util.CLOUD_HOST) {
			this._options.secure = true;
		}
		// Set a custom log function if present
		if (this._options.logFunction) {
			logger.setLogFunction(this._options.logFunction);
		}

		logger.logLevel = this._options.debug || 0;

		this._api = new API(options);
		this._socket = this._createServerConnection();

		// Sanity checks
		// Ensure WebRTC supported
		if (!util.supports.data) {
			this._delayedAbort(
				MeshClientErrorType.BrowserIncompatible,
				"The current browser does not support WebRTC data channels",
			);
			return;
		}

		// Ensure alphanumeric id
		if (!!userId && !util.validateId(userId)) {
			this._delayedAbort(
				MeshClientErrorType.InvalidID,
				`ID "${userId}" is invalid`,
			);
			return;
		}

		if (userId) {
			this._initialize(userId);
		} else {
			this._api
				.retrieveId()
				.then((id) => this._initialize(id))
				.catch((error) => this._abort(MeshClientErrorType.ServerError, error));
		}
	}

	private _createServerConnection(): Socket {
		const socket = new Socket(
			this._options.secure,
			this._options.host!,
			this._options.port!,
			this._options.path!,
			this._options.key!,
			this._options.pingInterval,
		);

		socket.on(SocketEventType.Message, (data: ServerMessage) => {
			this._handleMessage(data);
		});

		socket.on(SocketEventType.Error, (error: string) => {
			this._abort(MeshClientErrorType.SocketError, error);
		});

		socket.on(SocketEventType.Disconnected, () => {
			if (this.disconnected) {
				return;
			}

			this.emitError(MeshClientErrorType.Network, "Lost connection to server.");
			this.disconnect();
		});

		socket.on(SocketEventType.Close, () => {
			if (this.disconnected) {
				return;
			}

			this._abort(
				MeshClientErrorType.SocketClosed,
				"Underlying socket is already closed.",
			);
		});

		return socket;
	}

	/** Initialize a connection with the server. */
	private _initialize(id: string): void {
		this._id = id;
		this.socket.start(id, this._options.token!);
	}

	/** Handles messages from the server. */
	private _handleMessage(message: ServerMessage): void {
		const type = message.type;
		const payload = message.payload;
		const peerId = message.src;

		switch (type) {
			case ServerMessageType.Open: // The connection to the server is open.
				this._lastServerId = this.id;
				this._open = true;
				this.emit("open", this.id);
				break;
			case ServerMessageType.Error: // Server error.
				this._abort(MeshClientErrorType.ServerError, payload.msg);
				break;
			case ServerMessageType.IdTaken: // The selected ID is taken.
				this._abort(
					MeshClientErrorType.UnavailableID,
					`ID "${this.id}" is taken`,
				);
				break;
			case ServerMessageType.InvalidKey: // The given API key cannot be found.
				this._abort(
					MeshClientErrorType.InvalidKey,
					`API KEY "${this._options.key}" is invalid`,
				);
				break;
			case ServerMessageType.Leave: // Another peer has closed its connection to this peer.
				logger.log(`Received leave message from ${peerId}`);
				this._cleanupPeer(peerId);
				break;
			case ServerMessageType.Expire: // The offer sent to a peer has expired without response.
				this.emitError(
					MeshClientErrorType.PeerUnavailable,
					`Could not connect to peer ${peerId}`,
				);
				break;
			case ServerMessageType.Offer: {
				// we should consider switching this to CALL/CONNECT, but this is the least breaking option.
				const connectionId = payload.connectionId;
				const node = this._remoteNodes.get(peerId);
				let connection = node?.getConnection(connectionId);

				if (connection) {
					connection.close();
					logger.warn(
						`Offer received for existing Connection ID:${connectionId}`,
					);
				}

				// Create a new connection.
				if (payload.type === ConnectionType.Data) {
					// Get or create node for this peer first
					let node: RemoteNode | undefined = this._remoteNodes.get(peerId);
					if (!node) {
						node = new RemoteNode(peerId, this, payload.metadata);
						this._remoteNodes.set(peerId, node);

						// Set up mesh networking for incoming connections
						this._handleMeshNetworking(node);

						this.emit("connection", node);

						// Transfer any existing lost messages from peer to node
						const peerLostMessages = this._getMessages(connectionId);
						for (const msg of peerLostMessages) {
							node._storeMessage(connectionId, msg);
						}
					}

					const dataConnection = new this._serializers[payload.serialization](
						peerId,
						this,
						node,
						{
							connectionId: connectionId,
							_payload: payload,
							metadata: payload.metadata,
							label: payload.label,
							serialization: payload.serialization,
							reliable: payload.reliable,
						},
					);
					connection = dataConnection;

					node._addConnection(dataConnection);
				} else {
					logger.warn(`Received malformed connection type:${payload.type}`);
					return;
				}

				break;
			}
			default: {
				if (!payload) {
					logger.warn(
						`You received a malformed message from ${peerId} of type ${type}`,
					);
					return;
				}

				const connectionId = payload.connectionId;
				const node = this._remoteNodes.get(peerId);
				const connection = node?.getConnection(connectionId);

				if (connection && connection.peerConnection) {
					// Pass it on.
					connection.handleMessage(message);
				} else if (connectionId) {
					// Store for possible later use in the appropriate node
					const node = this._remoteNodes.get(peerId);
					if (node) {
						node._storeMessage(connectionId, message);
					} else {
						// If no node exists yet, store in peer's lost messages as fallback
						this._storeMessage(connectionId, message);
					}
				} else {
					logger.warn("You received an unrecognized message:", message);
				}
				break;
			}
		}
	}

	/** Stores messages without a set up connection, to be claimed later. */
	private _storeMessage(connectionId: string, message: ServerMessage): void {
		if (!this._lostMessages.has(connectionId)) {
			this._lostMessages.set(connectionId, []);
		}

		this._lostMessages.get(connectionId).push(message);
	}

	/**
	 * Retrieve messages from lost message store
	 * @internal
	 */
	//TODO Change it to private
	public _getMessages(connectionId: string): ServerMessage[] {
		const messages = this._lostMessages.get(connectionId);

		if (messages) {
			this._lostMessages.delete(connectionId);
			return messages;
		}

		return [];
	}

	/**
	 * Connects to the remote peer specified by id and returns a Node.
	 * @param peer The brokering ID of the remote peer (their {@apilink Peer.id}).
	 * @param options for specifying details about Peer Connection
	 */
	connect(peer: string, options: MeshClientConnectOption = {}): RemoteNode {
		options = {
			serialization: "default",
			...options,
		};
		if (this.disconnected) {
			logger.warn(
				"You cannot connect to a new Peer because you called " +
					".disconnect() on this Peer and ended your connection with the " +
					"server. You can create a new Peer to reconnect, or call reconnect " +
					"on this peer if you believe its ID to still be available.",
			);
			this.emitError(
				MeshClientErrorType.Disconnected,
				"Cannot connect to new Peer after disconnecting from server.",
			);
			return;
		}

		// Prevent duplicate connection attempts
		if (this._connectionAttempts.has(peer)) {
			logger.warn(`Connection attempt to ${peer} already in progress`);
			return;
		}

		// Mark this peer as being attempted
		this._connectionAttempts.add(peer);

		// Get or create node for this peer
		let node: RemoteNode | undefined = this._remoteNodes.get(peer);
		if (!node) {
			node = new RemoteNode(peer, this, options.metadata);
			this._remoteNodes.set(peer, node);

			// Set up mesh networking for this node
			this._handleMeshNetworking(node);
		}

		// Create data connection
		const dataConnection = new this._serializers[options.serialization](
			peer,
			this,
			node,
			options,
		);
		node._addConnection(dataConnection);

		// Clean up connection attempts when the node closes or errors
		const cleanupAttempt = () => {
			this._connectionAttempts.delete(peer);
		};

		// Set up one-time listeners for cleanup
		const setupCleanup = () => {
			node.once("close", cleanupAttempt);
			node.once("error", cleanupAttempt);
			// Also clean up when connection succeeds
			node.once("open", cleanupAttempt);
		};

		// Only set up cleanup if this is the first connection to this node
		if (!node.open && node.connectionCount === 1) {
			setupCleanup();
		}

		return node;
	}

	/** Clean up lost messages for a connection */
	_cleanupLostMessages(connectionId: string): void {
		this._lostMessages.delete(connectionId);
	}

	/** Remove a node from this peer. */
	_removeNode(node: RemoteNode): void {
		this._remoteNodes.delete(node.peer);
		// Clean up connection attempts tracking
		this._connectionAttempts.delete(node.peer);
		// Clean up mesh handshake tracking
		const handshake = this._meshHandshakes.get(node.peer);
		if (handshake?.retryTimeout) {
			clearTimeout(handshake.retryTimeout);
		}
		this._meshHandshakes.delete(node.peer);
	}

	/** Get a node for a specific peer ID. */
	getNode(peerId: string): RemoteNode | undefined {
		return this._remoteNodes.get(peerId);
	}

	/**
	 * Broadcasts data to all connected nodes.
	 * @param data The data to send to all connected peers
	 * @returns The number of nodes the data was sent to
	 */
	broadcast(data: any): number {
		let sentCount = 0;

		for (const [peerId, node] of this._remoteNodes) {
			if (node.open) {
				try {
					node.send(data);
					sentCount++;
				} catch (error) {
					logger.warn(`Failed to send broadcast to ${peerId}:`, error);
				}
			}
		}

		return sentCount;
	}

	/** Get list of all connected peer IDs for mesh networking */
	private _getConnectedPeerIds(): string[] {
		const peerIds: string[] = [];
		for (const [peerId, node] of this._remoteNodes) {
			if (node.open) {
				peerIds.push(peerId);
			}
		}
		return peerIds;
	}

	/** Handle mesh networking when a node connects */
	private _handleMeshNetworking(node: RemoteNode): void {
		// Initialize handshake tracking
		const handshakeInfo = {
			sent: false,
			received: false,
			retryCount: 0,
			retryTimeout: undefined as any,
		};
		this._meshHandshakes.set(node.peer, handshakeInfo);

		// When a node opens, start the handshake process
		node.on("open", () => {
			this._sendMeshHandshake(node);
		});

		// Handle incoming mesh messages using internal event
		node.on("_internal_mesh_message" as any, (data: any) => {
			if (data && typeof data === "object") {
				switch (data.type) {
					case "mesh-peers":
						this._handleMeshPeers(node, data);
						break;
					case "mesh-peers-ack":
						this._handleMeshAck(node, data);
						break;
				}
			}
		});

		// Clean up on close
		node.on("close", () => {
			const handshake = this._meshHandshakes.get(node.peer);
			if (handshake?.retryTimeout) {
				clearTimeout(handshake.retryTimeout);
			}
			this._meshHandshakes.delete(node.peer);
		});
	}

	/** Send mesh handshake with retry logic */
	private _sendMeshHandshake(node: RemoteNode): void {
		const handshake = this._meshHandshakes.get(node.peer);
		if (!handshake || handshake.sent) return;

		const myPeers = this._getConnectedPeerIds().filter(
			(id) => id !== node.peer,
		);

		// Always send the handshake, even with empty peer list
		const message = {
			__peerJSInternal: true,
			type: "mesh-peers",
			peers: myPeers,
			timestamp: Date.now(),
			requiresAck: true,
		};

		try {
			node.send(message);
			handshake.sent = true;
			logger.log(
				`Sent mesh handshake to ${node.peer} with ${myPeers.length} peers`,
			);

			// Set up retry if we don't receive an ack
			if (
				!handshake.received &&
				handshake.retryCount < MeshClient.MESH_HANDSHAKE_MAX_RETRIES
			) {
				handshake.retryTimeout = setTimeout(
					() => {
						handshake.retryCount++;
						handshake.sent = false;
						logger.log(
							`Retrying mesh handshake to ${node.peer} (attempt ${handshake.retryCount})`,
						);
						this._sendMeshHandshake(node);
					},
					MeshClient.MESH_HANDSHAKE_RETRY_DELAY *
						Math.pow(2, handshake.retryCount),
				); // Exponential backoff
			}
		} catch (error) {
			logger.warn(`Failed to send mesh handshake to ${node.peer}:`, error);
		}
	}

	/** Handle incoming mesh peers message */
	private _handleMeshPeers(node: RemoteNode, data: any): void {
		const handshake = this._meshHandshakes.get(node.peer);
		if (!handshake) return;

		// Mark that we received their list
		handshake.received = true;

		// Send acknowledgment if requested
		if (data.requiresAck) {
			try {
				node.send({
					__peerJSInternal: true,
					type: "mesh-peers-ack",
					timestamp: data.timestamp,
				});
				logger.log(`Sent mesh-peers-ack to ${node.peer}`);
			} catch (error) {
				logger.warn(`Failed to send mesh-peers-ack to ${node.peer}:`, error);
			}
		}

		// Process the peer list
		const peerList = data.peers;
		if (Array.isArray(peerList)) {
			logger.log(`Received peer list from ${node.peer}:`, peerList);
			this._connectToMeshPeers(peerList);
		}

		// If we haven't sent our list yet, send it now
		if (!handshake.sent) {
			this._sendMeshHandshake(node);
		}
	}

	/** Handle mesh acknowledgment */
	private _handleMeshAck(node: RemoteNode, _data: any): void {
		const handshake = this._meshHandshakes.get(node.peer);
		if (!handshake) return;

		// Clear retry timeout
		if (handshake.retryTimeout) {
			clearTimeout(handshake.retryTimeout);
			handshake.retryTimeout = undefined;
		}

		logger.log(`Received mesh-peers-ack from ${node.peer}`);
	}

	/** Connect to a list of peers for mesh networking */
	private _connectToMeshPeers(peerIds: string[]): void {
		for (const peerId of peerIds) {
			// Skip if it's our own ID
			if (peerId === this.id) continue;

			// Skip if we already have a connection or attempt in progress
			if (
				this._remoteNodes.has(peerId) ||
				this._connectionAttempts.has(peerId)
			) {
				continue;
			}

			logger.log(`Connecting to mesh peer ${peerId}`);

			// Attempt connection - connect() will handle marking as attempted
			try {
				this.connect(peerId);
			} catch (error) {
				logger.warn(`Failed to connect to mesh peer ${peerId}:`, error);
				// If connection failed, it should have been cleaned up by connect()
				// but just in case, remove it from attempts
				this._connectionAttempts.delete(peerId);
			}
		}
	}

	private _delayedAbort(
		type: MeshClientErrorType,
		message: string | Error,
	): void {
		setTimeout(() => {
			this._abort(type, message);
		}, 0);
	}

	/**
	 * Emits an error message and destroys the Peer.
	 * The Peer is not destroyed if it's in a disconnected state, in which case
	 * it retains its disconnected state and its existing connections.
	 */
	private _abort(type: MeshClientErrorType, message: string | Error): void {
		logger.error("Aborting!");

		this.emitError(type, message);

		if (!this._lastServerId) {
			this.destroy();
		} else {
			this.disconnect();
		}
	}

	/**
	 * Destroys the Peer: closes all active connections as well as the connection
	 * to the server.
	 *
	 * :::caution
	 * This cannot be undone; the respective peer object will no longer be able
	 * to create or receive any connections, its ID will be forfeited on the server,
	 * and all of its data and media connections will be closed.
	 * :::
	 */
	destroy(): void {
		if (this.destroyed) {
			return;
		}

		logger.log(`Destroy peer with ID:${this.id}`);

		this.disconnect();
		this._cleanup();

		this._destroyed = true;

		this.emit("close");
	}

	/** Disconnects every connection on this peer. */
	private _cleanup(): void {
		// Close all nodes (which will close their connections)
		for (const node of this._remoteNodes.values()) {
			node.close();
		}
		this._remoteNodes.clear();

		this.socket.removeAllListeners();
	}

	/** Closes all connections to this peer. */
	private _cleanupPeer(peerId: string): void {
		const node = this._remoteNodes.get(peerId);
		if (node) {
			node.close();
		}
	}

	/**
	 * Disconnects the Peer's connection to the PeerServer. Does not close any
	 *  active connections.
	 * Warning: The peer can no longer create or accept connections after being
	 *  disconnected. It also cannot reconnect to the server.
	 */
	disconnect(): void {
		if (this.disconnected) {
			return;
		}

		const currentId = this.id;

		logger.log(`Disconnect peer with ID:${currentId}`);

		this._disconnected = true;
		this._open = false;

		this.socket.close();

		this._lastServerId = currentId;
		this._id = null;

		this.emit("disconnected", currentId);
	}

	/** Attempts to reconnect with the same ID.
	 *
	 * Only {@apilink Peer.disconnect | disconnected peers} can be reconnected.
	 * Destroyed peers cannot be reconnected.
	 * If the connection fails (as an example, if the peer's old ID is now taken),
	 * the peer's existing connections will not close, but any associated errors events will fire.
	 */
	reconnect(): void {
		if (this.disconnected && !this.destroyed) {
			logger.log(
				`Attempting reconnection to server with ID ${this._lastServerId}`,
			);
			this._disconnected = false;
			this._initialize(this._lastServerId!);
		} else if (this.destroyed) {
			throw new Error(
				"This peer cannot reconnect to the server. It has already been destroyed.",
			);
		} else if (!this.disconnected && !this.open) {
			// Do nothing. We're still connecting the first time.
			logger.error(
				"In a hurry? We're still trying to make the initial connection!",
			);
		} else {
			throw new Error(
				`Peer ${this.id} cannot reconnect because it is not disconnected from the server!`,
			);
		}
	}
}
