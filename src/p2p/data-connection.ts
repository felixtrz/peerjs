import logger from "../utils/logger";
import { Negotiator } from "./negotiator";
import {
	BaseConnectionErrorType,
	ConnectionType,
	DataConnectionErrorType,
	ServerMessageType,
} from "../utils/enums";
import type { MeshClient } from "../mesh-client";
import type { RemoteNode } from "../remote-node";
import type { ServerMessage } from "../server/server-message";
import {
	EventEmitterWithError,
	type EventsWithError,
	MeshClientError,
} from "./mesh-client-error";
import { randomToken } from "../utils/utils";

export interface BaseConnectionEvents<
	ErrorType extends string = BaseConnectionErrorType,
> extends EventsWithError<ErrorType> {
	/**
	 * Emitted when either you or the remote peer closes the connection.
	 *
	 * ```ts
	 * connection.on('close', () => { ... });
	 * ```
	 */
	close: () => void;
	/**
	 * ```ts
	 * connection.on('error', (error) => { ... });
	 * ```
	 */
	error: (error: MeshClientError<`${ErrorType}`>) => void;
	iceStateChanged: (state: RTCIceConnectionState) => void;
}

export interface DataConnectionEvents
	extends EventsWithError<DataConnectionErrorType | BaseConnectionErrorType>,
		BaseConnectionEvents<DataConnectionErrorType | BaseConnectionErrorType> {
	/**
	 * Emitted when data is received from the remote peer.
	 */
	data: (data: unknown) => void;
	/**
	 * Emitted when the connection is established and ready-to-use.
	 */
	open: () => void;
}

/**
 * Wraps a DataChannel between two Peers.
 */
export abstract class DataConnection extends EventEmitterWithError<
	DataConnectionErrorType | BaseConnectionErrorType,
	DataConnectionEvents
> {
	protected static readonly ID_PREFIX = "dc_";
	protected static readonly MAX_BUFFERED_AMOUNT = 8 * 1024 * 1024;

	protected _open = false;

	/**
	 * Any type of metadata associated with the connection,
	 * passed in by whoever initiated the connection.
	 */
	readonly metadata: any;
	connectionId: string;

	peerConnection: RTCPeerConnection;
	dataChannel: RTCDataChannel;

	/**
	 * The optional label passed in or assigned by PeerJS when the connection was initiated.
	 */
	label: string;

	/**
	 * Whether the data connection is active (e.g. open and ready for messages).
	 * You can check this if you want to set a maximum wait time for a connection.
	 */
	get open() {
		return this._open;
	}

	private _negotiator: Negotiator<DataConnection>;
	abstract readonly serialization: string;
	readonly reliable: boolean;

	public get type() {
		return ConnectionType.Data;
	}

	constructor(
		/**
		 * The ID of the peer on the other end of this connection.
		 */
		readonly peer: string,
		public provider: MeshClient,
		public node: RemoteNode,
		readonly options: any,
	) {
		super();

		this.metadata = options.metadata;

		this.connectionId =
			this.options.connectionId || DataConnection.ID_PREFIX + randomToken();

		this.label = this.options.label || this.connectionId;
		this.reliable = !!this.options.reliable;

		this._negotiator = new Negotiator(this);

		this._negotiator.startConnection(
			this.options._payload || {
				originator: true,
				reliable: this.reliable,
			},
		);
	}

	/** Called by the Negotiator when the DataChannel is ready. */
	_initializeDataChannel(dc: RTCDataChannel): void {
		this.dataChannel = dc;

		this.dataChannel.onopen = () => {
			logger.log(`DC#${this.connectionId} dc connection success`);
			this._open = true;
			this.emit("open");
		};

		this.dataChannel.onmessage = (e) => {
			logger.log(`DC#${this.connectionId} dc onmessage:`, e.data);
			// this._handleDataMessage(e);
		};

		this.dataChannel.onclose = () => {
			logger.log(`DC#${this.connectionId} dc closed for:`, this.peer);
			this.close();
		};
	}

	/**
	 * Exposed functionality for users.
	 */

	/** Allows user to close connection. */
	close(options?: { flush?: boolean }): void {
		if (options?.flush) {
			this.send({
				__peerData: {
					type: "close",
				},
			});
			return;
		}
		if (this._negotiator) {
			this._negotiator.cleanup();
			this._negotiator = null;
		}

		if (this.node) {
			this.node._removeConnection(this);
			this.node = null;
		}

		if (this.provider) {
			this.provider = null;
		}

		if (this.dataChannel) {
			this.dataChannel.onopen = null;
			this.dataChannel.onmessage = null;
			this.dataChannel.onclose = null;
			this.dataChannel = null;
		}

		if (!this.open) {
			return;
		}

		this._open = false;

		super.emit("close");
	}

	protected abstract _send(data: any, chunked: boolean): void | Promise<void>;

	/** Allows user to send data. */
	public send(data: any, chunked = false) {
		if (!this.open) {
			this.emitError(
				DataConnectionErrorType.NotOpenYet,
				"Connection is not open. You should listen for the `open` event before sending messages.",
			);
			return;
		}
		return this._send(data, chunked);
	}

	async handleMessage(message: ServerMessage) {
		const payload = message.payload;

		switch (message.type) {
			case ServerMessageType.Answer:
				await this._negotiator.handleSDP(message.type, payload.sdp);
				break;
			case ServerMessageType.Candidate:
				await this._negotiator.handleCandidate(payload.candidate);
				break;
			default:
				logger.warn(
					"Unrecognized message type:",
					message.type,
					"from peer:",
					this.peer,
				);
				break;
		}
	}
}
