import { WebSocket } from "mock-socket";
import "webrtc-adapter";

const fakeGlobals = {
	WebSocket,
	RTCSessionDescription: class RTCSessionDescription {
		type: RTCSdpType;
		sdp: string;
		
		constructor(init?: RTCSessionDescriptionInit) {
			this.type = init?.type || "offer";
			this.sdp = init?.sdp || "";
		}
		
		toJSON(): RTCSessionDescriptionInit {
			return {
				type: this.type,
				sdp: this.sdp,
			};
		}
	},
	MediaStream: class MediaStream {
		private readonly _tracks: MediaStreamTrack[] = [];

		constructor(tracks?: MediaStreamTrack[]) {
			if (tracks) {
				this._tracks = tracks;
			}
		}

		getTracks(): MediaStreamTrack[] {
			return this._tracks;
		}

		addTrack(track: MediaStreamTrack) {
			this._tracks.push(track);
		}
	},
	MediaStreamTrack: class MediaStreamTrack {
		kind: string;
		id: string;

		private static _idCounter = 0;

		constructor() {
			this.id = `track#${fakeGlobals.MediaStreamTrack._idCounter++}`;
		}
	},
	RTCPeerConnection: class RTCPeerConnection {
		private _senders: RTCRtpSender[] = [];
		localDescription: RTCSessionDescription | null = null;
		remoteDescription: RTCSessionDescription | null = null;
		signalingState: RTCSignalingState = "stable";
		iceConnectionState: RTCIceConnectionState = "new";
		iceGatheringState: RTCIceGatheringState = "new";
		connectionState: RTCPeerConnectionState = "new";
		onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
		ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;
		onicecandidateerror: ((event: RTCPeerConnectionIceErrorEvent) => void) | null = null;
		onconnectionstatechange: ((event: Event) => void) | null = null;
		oniceconnectionstatechange: ((event: Event) => void) | null = null;
		onicegatheringstatechange: ((event: Event) => void) | null = null;
		onnegotiationneeded: ((event: Event) => void) | null = null;
		onsignalingstatechange: ((event: Event) => void) | null = null;

		constructor(_configuration?: RTCConfiguration) {
			// Mock implementation
		}

		close() {
			this.iceConnectionState = "closed";
			this.connectionState = "closed";
			this.signalingState = "closed";
		}

		createDataChannel(label: string, _options?: RTCDataChannelInit): RTCDataChannel {
			return {
				label,
				id: Math.floor(Math.random() * 65535),
				ordered: true,
				maxPacketLifeTime: null,
				maxRetransmits: null,
				protocol: "",
				negotiated: false,
				readyState: "connecting" as RTCDataChannelState,
				bufferedAmount: 0,
				bufferedAmountLowThreshold: 0,
				binaryType: "arraybuffer" as BinaryType,
				onopen: null,
				onbufferedamountlow: null,
				onerror: null,
				onclose: null,
				onmessage: null,
				send: jest.fn(),
				close: jest.fn(),
				addEventListener: jest.fn(),
				removeEventListener: jest.fn(),
				dispatchEvent: jest.fn(),
			} as unknown as RTCDataChannel;
		}

		createOffer(_options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> {
			return Promise.resolve({
				type: "offer",
				sdp: "mock-sdp-offer",
			});
		}

		createAnswer(_options?: RTCAnswerOptions): Promise<RTCSessionDescriptionInit> {
			return Promise.resolve({
				type: "answer",
				sdp: "mock-sdp-answer",
			});
		}

		setLocalDescription(description?: RTCLocalSessionDescriptionInit): Promise<void> {
			this.localDescription = description as RTCSessionDescription;
			return Promise.resolve();
		}

		setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
			this.remoteDescription = description as RTCSessionDescription;
			return Promise.resolve();
		}

		addIceCandidate(_candidate?: RTCIceCandidateInit): Promise<void> {
			return Promise.resolve();
		}

		getStats(_selector?: MediaStreamTrack | null): Promise<RTCStatsReport> {
			return Promise.resolve(new Map() as RTCStatsReport);
		}

		addTrack(track: MediaStreamTrack, ..._stream: MediaStream[]): RTCRtpSender {
			const newSender = new RTCRtpSender();
			newSender.replaceTrack(track);

			this._senders.push(newSender);

			return newSender;
		}

		// removeTrack(_: RTCRtpSender): void { }

		getSenders(): RTCRtpSender[] {
			return this._senders;
		}
	},
	RTCRtpSender: class RTCRtpSender {
		readonly dtmf: RTCDTMFSender | null;
		readonly rtcpTransport: RTCDtlsTransport | null;
		track: MediaStreamTrack | null;
		readonly transport: RTCDtlsTransport | null;

		replaceTrack(withTrack: MediaStreamTrack | null): Promise<void> {
			this.track = withTrack;

			return Promise.resolve();
		}
	},
};

Object.assign(global, fakeGlobals);
Object.assign(window, fakeGlobals);
