import logger from "../utils/logger";
import type { DataConnection } from "./data-connection";
import {
	BaseConnectionErrorType,
	ConnectionType,
	MeshClientErrorType,
	ServerMessageType,
} from "../utils/enums";

/**
 * Manages all negotiations between Peers.
 */
export class Negotiator<Connection extends DataConnection> {
	constructor(readonly connection: Connection) {}

	/** Returns a PeerConnection object set up correctly (for data, media). */
	startConnection(options: any) {
		const peerConnection = this._startPeerConnection();

		// Set the connection's PC.
		this.connection.peerConnection = peerConnection;

		// Media-specific logic removed as we only support DataConnection now

		// What do we need to do now?
		if (options.originator) {
			const dataConnection = this.connection;

			const config: RTCDataChannelInit = { ordered: !!options.reliable };

			const dataChannel = peerConnection.createDataChannel(
				dataConnection.label,
				config,
			);
			dataConnection._initializeDataChannel(dataChannel);

			void this._makeOffer();
		} else {
			void this.handleSDP("OFFER", options.sdp);
		}
	}

	/** Start a PC. */
	private _startPeerConnection(): RTCPeerConnection {
		logger.log("Creating RTCPeerConnection.");

		const peerConnection = new RTCPeerConnection(
			this.connection.provider.options.config,
		);

		this._setupListeners(peerConnection);

		return peerConnection;
	}

	/** Set up various WebRTC listeners. */
	private _setupListeners(peerConnection: RTCPeerConnection) {
		const peerId = this.connection.peer;
		const connectionId = this.connection.connectionId;
		const connectionType = this.connection.type;
		const provider = this.connection.provider;

		// ICE CANDIDATES.
		logger.log("Listening for ICE candidates.");

		peerConnection.onicecandidate = (evt) => {
			if (!evt.candidate || !evt.candidate.candidate) return;

			logger.log(`Received ICE candidates for ${peerId}:`, evt.candidate);

			provider.socket.send({
				type: ServerMessageType.Candidate,
				payload: {
					candidate: evt.candidate,
					type: connectionType,
					connectionId: connectionId,
				},
				dst: peerId,
			});
		};

		peerConnection.oniceconnectionstatechange = () => {
			switch (peerConnection.iceConnectionState) {
				case "failed":
					logger.log(
						"iceConnectionState is failed, closing connections to " + peerId,
					);
					this.connection.emitError(
						BaseConnectionErrorType.NegotiationFailed,
						"Negotiation of connection to " + peerId + " failed.",
					);
					this.connection.close();
					break;
				case "closed":
					logger.log(
						"iceConnectionState is closed, closing connections to " + peerId,
					);
					this.connection.emitError(
						BaseConnectionErrorType.ConnectionClosed,
						"Connection to " + peerId + " closed.",
					);
					this.connection.close();
					break;
				case "disconnected":
					logger.log(
						"iceConnectionState changed to disconnected on the connection with " +
							peerId,
					);
					break;
				case "completed":
					peerConnection.onicecandidate = () => {};
					break;
			}

			this.connection.emit(
				"iceStateChanged",
				peerConnection.iceConnectionState,
			);
		};

		// DATACONNECTION.
		logger.log("Listening for data channel");
		// Fired between offer and answer, so options should already be saved
		// in the options hash.
		peerConnection.ondatachannel = (evt) => {
			logger.log("Received data channel");

			const dataChannel = evt.channel;
			const node = provider.getNode(peerId);
			const connection = <DataConnection>node?.getConnection(connectionId);

			connection._initializeDataChannel(dataChannel);
		};
	}

	cleanup(): void {
		logger.log("Cleaning up PeerConnection to " + this.connection.peer);

		const peerConnection = this.connection.peerConnection;

		if (!peerConnection) {
			return;
		}

		this.connection.peerConnection = null;

		//unsubscribe from all PeerConnection's events
		peerConnection.onicecandidate =
			peerConnection.oniceconnectionstatechange =
			peerConnection.ondatachannel =
			peerConnection.ontrack =
				() => {};

		const peerConnectionNotClosed = peerConnection.signalingState !== "closed";
		let dataChannelNotClosed = false;

		const dataChannel = this.connection.dataChannel;

		if (dataChannel) {
			dataChannelNotClosed =
				!!dataChannel.readyState && dataChannel.readyState !== "closed";
		}

		if (peerConnectionNotClosed || dataChannelNotClosed) {
			peerConnection.close();
		}
	}

	private async _makeOffer(): Promise<void> {
		const peerConnection = this.connection.peerConnection;
		const provider = this.connection.provider;

		try {
			const offer = await peerConnection.createOffer(
				this.connection.options.constraints,
			);

			logger.log("Created offer.");

			if (
				this.connection.options.sdpTransform &&
				typeof this.connection.options.sdpTransform === "function"
			) {
				offer.sdp =
					this.connection.options.sdpTransform(offer.sdp) || offer.sdp;
			}

			try {
				await peerConnection.setLocalDescription(offer);

				logger.log(
					"Set localDescription:",
					offer,
					`for:${this.connection.peer}`,
				);

				let payload: any = {
					sdp: offer,
					type: this.connection.type,
					connectionId: this.connection.connectionId,
					metadata: this.connection.metadata,
				};

				if (this.connection.type === ConnectionType.Data) {
					const dataConnection = <DataConnection>(<unknown>this.connection);

					payload = {
						...payload,
						label: dataConnection.label,
						reliable: dataConnection.reliable,
						serialization: dataConnection.serialization,
					};
				}

				provider.socket.send({
					type: ServerMessageType.Offer,
					payload,
					dst: this.connection.peer,
				});
			} catch (err) {
				// TODO: investigate why _makeOffer is being called from the answer
				if (
					err !=
					"OperationError: Failed to set local offer sdp: Called in wrong state: kHaveRemoteOffer"
				) {
					provider.emitError(MeshClientErrorType.WebRTC, err);
					logger.log("Failed to setLocalDescription, ", err);
				}
			}
		} catch (err_1) {
			provider.emitError(MeshClientErrorType.WebRTC, err_1);
			logger.log("Failed to createOffer, ", err_1);
		}
	}

	private async _makeAnswer(): Promise<void> {
		const peerConnection = this.connection.peerConnection;
		const provider = this.connection.provider;

		try {
			const answer = await peerConnection.createAnswer();
			logger.log("Created answer.");

			if (
				this.connection.options.sdpTransform &&
				typeof this.connection.options.sdpTransform === "function"
			) {
				answer.sdp =
					this.connection.options.sdpTransform(answer.sdp) || answer.sdp;
			}

			try {
				await peerConnection.setLocalDescription(answer);

				logger.log(
					`Set localDescription:`,
					answer,
					`for:${this.connection.peer}`,
				);

				provider.socket.send({
					type: ServerMessageType.Answer,
					payload: {
						sdp: answer,
						type: this.connection.type,
						connectionId: this.connection.connectionId,
					},
					dst: this.connection.peer,
				});
			} catch (err) {
				provider.emitError(MeshClientErrorType.WebRTC, err);
				logger.log("Failed to setLocalDescription, ", err);
			}
		} catch (err_1) {
			provider.emitError(MeshClientErrorType.WebRTC, err_1);
			logger.log("Failed to create answer, ", err_1);
		}
	}

	/** Handle an SDP. */
	async handleSDP(type: string, sdp: any): Promise<void> {
		sdp = new RTCSessionDescription(sdp);
		const peerConnection = this.connection.peerConnection;
		const provider = this.connection.provider;

		logger.log("Setting remote description", sdp);

		const self = this;

		try {
			await peerConnection.setRemoteDescription(sdp);
			logger.log(`Set remoteDescription:${type} for:${this.connection.peer}`);
			if (type === "OFFER") {
				await self._makeAnswer();
			}
		} catch (err) {
			provider.emitError(MeshClientErrorType.WebRTC, err);
			logger.log("Failed to setRemoteDescription, ", err);
		}
	}

	/** Handle a candidate. */
	async handleCandidate(ice: RTCIceCandidate) {
		logger.log(`handleCandidate:`, ice);

		try {
			await this.connection.peerConnection.addIceCandidate(ice);
			logger.log(`Added ICE candidate for:${this.connection.peer}`);
		} catch (err) {
			this.connection.provider.emitError(MeshClientErrorType.WebRTC, err);
			logger.log("Failed to handleCandidate, ", err);
		}
	}
}
