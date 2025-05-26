import { Socket } from "../server/socket";
import { API } from "../server/api";
import type { ServerMessage } from "../server/server-message";
import type { MeshClientOptions } from "./client";
import {
	MeshClientErrorType,
	ServerMessageType,
	SocketEventType,
} from "../utils/enums";
import logger from "../utils/logger";
import { EventEmitter } from "events";

export interface ServerManagerEvents {
	message: (message: ServerMessage) => void;
	error: (type: MeshClientErrorType, message: string | Error) => void;
	disconnect: () => void;
	close: () => void;
	open: (id: string) => void;
}

/**
 * Manages the connection to the PeerJS server and handles server messages
 */
export class ServerManager extends EventEmitter {
	private readonly _options: MeshClientOptions;
	private readonly _api: API;
	private readonly _socket: Socket;
	private _id: string | null = null;
	private _open = false;

	constructor(options: MeshClientOptions) {
		super();
		this._options = options;
		this._api = new API(options);
		this._socket = this._createServerConnection();
	}

	get id(): string | null {
		return this._id;
	}

	get open(): boolean {
		return this._open;
	}

	get socket(): Socket {
		return this._socket;
	}

	/**
	 * Initialize connection with the server
	 */
	async connect(userId?: string): Promise<void> {
		if (userId) {
			this._initialize(userId);
		} else {
			try {
				const id = await this._api.retrieveId();
				this._initialize(id);
			} catch (error) {
				this.emit("error", MeshClientErrorType.ServerError, error);
			}
		}
	}

	/**
	 * Disconnect from the server
	 */
	disconnect(): void {
		if (this._socket) {
			this._socket.close();
		}
		this._open = false;
	}

	/**
	 * Send a message to the server
	 */
	send(message: any): void {
		if (!this._open) {
			return;
		}

		this._socket.send(message);
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
			this.emit("error", MeshClientErrorType.SocketError, error);
		});

		socket.on(SocketEventType.Disconnected, () => {
			this.emit("disconnect");
		});

		socket.on(SocketEventType.Close, () => {
			this.emit("close");
		});

		return socket;
	}

	private _initialize(id: string): void {
		this._id = id;
		this._socket.start(id, this._options.token);
	}

	/** @internal */
	_handleMessage(message: ServerMessage): void {
		const type = message.type;
		const payload = message.payload;

		switch (type) {
			case ServerMessageType.Open:
				this._open = true;

				logger.log(`Connected to server with ID: ${this._id}`);
				this.emit("open", this._id!);
				break;

			case ServerMessageType.Error:
				logger.error("Server error:", payload.msg);
				this.emit("error", MeshClientErrorType.ServerError, payload.msg);
				break;

			case ServerMessageType.IdTaken:
				logger.error(`ID "${this._id}" is taken`);
				this.emit("error", MeshClientErrorType.UnavailableID, `ID "${this._id}" is taken`);
				break;

			case ServerMessageType.InvalidKey:
				logger.error("Invalid key provided");
				this.emit("error", MeshClientErrorType.InvalidKey, "Invalid key provided");
				break;

			default:
				// Forward other message types to the main client
				this.emit("message", message);
				break;
		}
	}
}