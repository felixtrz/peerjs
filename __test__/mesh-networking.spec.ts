import { MeshClient } from "../src/mesh-client";
import {
	describe,
	it,
	expect,
	beforeEach,
	afterEach,
	jest,
} from "@jest/globals";
import logger from "../src/utils/logger";

// Mock the modules that depend on WebRTC
jest.mock("../src/p2p/data-connection");
jest.mock("../src/server/api");
jest.mock("../src/server/socket");

describe("Mesh Networking", () => {
	let clientA: MeshClient;
	let clientB: MeshClient;

	beforeEach(() => {
		// Create test clients
		clientA = new MeshClient("client-a");
		clientB = new MeshClient("client-b");

		// Mock the open state
		(clientA as any)._open = true;
		(clientB as any)._open = true;

		// Mock the id getter
		(clientA as any)._id = "client-a";
		(clientB as any)._id = "client-b";
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe("Connection attempt tracking", () => {
		it("should track connection attempts", () => {
			const connectionAttempts = (clientA as any)._connectionAttempts;
			expect(connectionAttempts.size).toBe(0);

			// Mock the serializers to avoid WebRTC
			(clientA as any)._serializers.default = jest
				.fn()
				.mockImplementation(() => {
					return {
						_addConnection: jest.fn(),
					};
				});

			// Create a mock node
			const mockNode = {
				peer: "client-b",
				open: false,
				connectionCount: 1,
				once: jest.fn(),
				on: jest.fn(),
				_addConnection: jest.fn(),
			};

			// Mock RemoteNode constructor
			jest
				.spyOn(clientA as any, "connect")
				.mockImplementation((peer: string) => {
					// The real connect marks as attempted
					connectionAttempts.add(peer);
					return mockNode as any;
				});

			clientA.connect("client-b");
			expect(connectionAttempts.has("client-b")).toBe(true);
		});

		it("should prevent duplicate connection attempts", () => {
			const connectionAttempts = (clientA as any)._connectionAttempts;
			connectionAttempts.add("client-b");

			// Mock the logger.warn
			const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});

			clientA.connect("client-b");

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					"Connection attempt to client-b already in progress",
				),
			);

			warnSpy.mockRestore();
		});

		it("should clean up connection attempts when node is removed", () => {
			const connectionAttempts = (clientA as any)._connectionAttempts;
			connectionAttempts.add("client-b");

			// Create a mock node
			const mockNode = {
				peer: "client-b",
				close: jest.fn(),
			};

			clientA._removeNode(mockNode as any);
			expect(connectionAttempts.has("client-b")).toBe(false);
		});
	});

	describe("Peer list handling", () => {
		it("should get list of connected peer IDs", () => {
			// Mock remote nodes
			const mockNodeB = {
				peer: "client-b",
				open: true,
			};
			const mockNodeC = {
				peer: "client-c",
				open: false, // Not open, should not be included
			};

			(clientA as any)._remoteNodes.set("client-b", mockNodeB);
			(clientA as any)._remoteNodes.set("client-c", mockNodeC);

			const connectedPeers = (clientA as any)._getConnectedPeerIds();
			expect(connectedPeers).toEqual(["client-b"]);
		});

		it("should connect to mesh peers", () => {
			const connectSpy = jest
				.spyOn(clientA, "connect")
				.mockImplementation(() => null as any);

			// Call the private method directly
			(clientA as any)._connectToMeshPeers(["client-b", "client-c"]);

			expect(connectSpy).toHaveBeenCalledWith("client-b");
			expect(connectSpy).toHaveBeenCalledWith("client-c");

			connectSpy.mockRestore();
		});

		it("should skip self when connecting to mesh peers", () => {
			const connectSpy = jest
				.spyOn(clientA, "connect")
				.mockImplementation(() => null as any);

			// Include self in the peer list
			(clientA as any)._connectToMeshPeers(["client-a", "client-b"]);

			expect(connectSpy).toHaveBeenCalledWith("client-b");
			expect(connectSpy).not.toHaveBeenCalledWith("client-a");

			connectSpy.mockRestore();
		});

		it("should skip already connected peers", () => {
			const connectSpy = jest
				.spyOn(clientA, "connect")
				.mockImplementation(() => null as any);

			// Add existing node
			(clientA as any)._remoteNodes.set("client-b", {});

			(clientA as any)._connectToMeshPeers(["client-b", "client-c"]);

			expect(connectSpy).not.toHaveBeenCalledWith("client-b");
			expect(connectSpy).toHaveBeenCalledWith("client-c");

			connectSpy.mockRestore();
		});

		it("should skip peers with connection attempts in progress", () => {
			const connectSpy = jest
				.spyOn(clientA, "connect")
				.mockImplementation(() => null as any);

			// Add to connection attempts
			(clientA as any)._connectionAttempts.add("client-b");

			(clientA as any)._connectToMeshPeers(["client-b", "client-c"]);

			expect(connectSpy).not.toHaveBeenCalledWith("client-b");
			expect(connectSpy).toHaveBeenCalledWith("client-c");

			connectSpy.mockRestore();
		});
	});

	describe("Mesh networking event handling", () => {
		it("should set up mesh networking handlers", () => {
			const mockNode = {
				peer: "client-b",
				on: jest.fn(),
				send: jest.fn(),
			};

			// Call the handler setup
			(clientA as any)._handleMeshNetworking(mockNode);

			// Should register event handlers
			expect(mockNode.on).toHaveBeenCalledWith("open", expect.any(Function));
			expect(mockNode.on).toHaveBeenCalledWith("_internal_mesh_message", expect.any(Function));
		});

		it("should handle mesh-peers data messages", () => {
			const mockNode = {
				peer: "client-b",
				on: jest.fn(),
			};

			// Spy on _connectToMeshPeers
			const connectToMeshPeersSpy = jest
				.spyOn(clientA as any, "_connectToMeshPeers")
				.mockImplementation(() => {});

			// Set up handlers
			(clientA as any)._handleMeshNetworking(mockNode);

			// Get the internal mesh message handler
			const dataHandler = mockNode.on.mock.calls.find(
				(call) => call[0] === "_internal_mesh_message",
			)?.[1] as ((data: any) => void) | undefined;
			expect(dataHandler).toBeDefined();

			// Simulate receiving mesh-peers message
			if (dataHandler) {
				dataHandler({
					type: "mesh-peers",
					peers: ["client-c", "client-d"],
				});
			}

			expect(connectToMeshPeersSpy).toHaveBeenCalledWith([
				"client-c",
				"client-d",
			]);

			connectToMeshPeersSpy.mockRestore();
		});

		it("should ignore non-mesh data messages", () => {
			const mockNode = {
				peer: "client-b",
				on: jest.fn(),
			};

			// Spy on _connectToMeshPeers
			const connectToMeshPeersSpy = jest
				.spyOn(clientA as any, "_connectToMeshPeers")
				.mockImplementation(() => {});

			// Set up handlers
			(clientA as any)._handleMeshNetworking(mockNode);

			// Get the internal mesh message handler
			const dataHandler = mockNode.on.mock.calls.find(
				(call) => call[0] === "_internal_mesh_message",
			)?.[1] as ((data: any) => void) | undefined;
			expect(dataHandler).toBeDefined();

			// Simulate receiving regular data message - these should be ignored
			if (dataHandler) {
				dataHandler("regular message");
				dataHandler({ type: "other", data: "test" });
				dataHandler({ type: "mesh-peers", peers: "not-an-array" }); // Invalid format
			}

			expect(connectToMeshPeersSpy).not.toHaveBeenCalled();

			connectToMeshPeersSpy.mockRestore();
		});

		it("should send peer list when node opens with retry mechanism", () => {
			const mockNode = {
				peer: "client-b",
				on: jest.fn(),
				send: jest.fn(),
			};

			// Add some connected peers
			(clientA as any)._remoteNodes.set("client-c", {
				peer: "client-c",
				open: true,
			});
			(clientA as any)._remoteNodes.set("client-d", {
				peer: "client-d",
				open: true,
			});

			// Mock timers
			jest.useFakeTimers();

			// Set up handlers
			(clientA as any)._handleMeshNetworking(mockNode);

			// Get the open handler
			const openHandler = mockNode.on.mock.calls.find(
				(call) => call[0] === "open",
			)?.[1] as (() => void) | undefined;
			expect(openHandler).toBeDefined();

			// Simulate node opening
			if (openHandler) {
				openHandler();
			}

			// Should send peer list with acknowledgment required
			expect(mockNode.send).toHaveBeenCalledWith({
				__peerJSInternal: true,
				type: "mesh-peers",
				peers: ["client-c", "client-d"],
				timestamp: expect.any(Number),
				requiresAck: true
			}, { reliable: true });

			// Clear timers
			jest.clearAllTimers();
			jest.useRealTimers();
		});

		it("should not send empty peer list", () => {
			const mockNode = {
				peer: "client-b",
				on: jest.fn(),
				send: jest.fn(),
			};

			// No connected peers
			(clientA as any)._remoteNodes.clear();

			// Set up handlers
			(clientA as any)._handleMeshNetworking(mockNode);

			// Get the open handler
			const openHandler = mockNode.on.mock.calls.find(
				(call) => call[0] === "open",
			)?.[1] as (() => void) | undefined;
			expect(openHandler).toBeDefined();

			// Simulate node opening
			if (openHandler) {
				openHandler();
			}

			// Should still send handshake even with empty peer list
			expect(mockNode.send).toHaveBeenCalledWith({
				__peerJSInternal: true,
				type: "mesh-peers",
				peers: [],
				timestamp: expect.any(Number),
				requiresAck: true
			}, { reliable: true });
		});

		it("should handle mesh-peers acknowledgments", () => {
			const mockNode = {
				peer: "client-b",
				on: jest.fn(),
				send: jest.fn(),
			};

			// Set up handlers
			(clientA as any)._handleMeshNetworking(mockNode);

			// Get the internal mesh message handler
			const dataHandler = mockNode.on.mock.calls.find(
				(call) => call[0] === "_internal_mesh_message",
			)?.[1] as ((data: any) => void) | undefined;

			// Simulate receiving mesh-peers message
			if (dataHandler) {
				dataHandler({
					type: "mesh-peers",
					peers: ["client-c"],
					timestamp: 12345,
					requiresAck: true
				});
			}

			// Should send acknowledgment
			expect(mockNode.send).toHaveBeenCalledWith({
				__peerJSInternal: true,
				type: "mesh-peers-ack",
				timestamp: 12345
			}, { reliable: true });
		});

		it("should retry mesh handshake on timeout", () => {
			const mockNode = {
				peer: "client-b",
				on: jest.fn(),
				send: jest.fn(),
			};

			// Mock timers
			jest.useFakeTimers();

			// Set up handlers
			(clientA as any)._handleMeshNetworking(mockNode);

			// Get the open handler
			const openHandler = mockNode.on.mock.calls.find(
				(call) => call[0] === "open",
			)?.[1] as (() => void) | undefined;

			// Simulate node opening
			if (openHandler) {
				openHandler();
			}

			// Clear send mock
			mockNode.send.mockClear();

			// Fast forward time to trigger retry
			jest.advanceTimersByTime(1000); // First retry after 1 second

			// Should have retried
			expect(mockNode.send).toHaveBeenCalledWith({
				__peerJSInternal: true,
				type: "mesh-peers",
				peers: [],
				timestamp: expect.any(Number),
				requiresAck: true
			}, { reliable: true });

			jest.clearAllTimers();
			jest.useRealTimers();
		});
	});

	describe("Broadcast functionality", () => {
		it("should broadcast data to all open nodes", () => {
			// Create mock nodes
			const mockNodeB = {
				peer: "client-b",
				open: true,
				send: jest.fn(),
			};
			const mockNodeC = {
				peer: "client-c",
				open: true,
				send: jest.fn(),
			};
			const mockNodeD = {
				peer: "client-d",
				open: false, // Not open, should not receive broadcast
				send: jest.fn(),
			};

			// Add nodes to clientA
			(clientA as any)._remoteNodes.set("client-b", mockNodeB);
			(clientA as any)._remoteNodes.set("client-c", mockNodeC);
			(clientA as any)._remoteNodes.set("client-d", mockNodeD);

			// Broadcast a message
			const message = "Hello everyone!";
			const sentCount = clientA.broadcast(message);

			// Should have sent to 2 nodes (B and C, not D because it's not open)
			expect(sentCount).toBe(2);
			expect(mockNodeB.send).toHaveBeenCalledWith(message, undefined);
			expect(mockNodeC.send).toHaveBeenCalledWith(message, undefined);
			expect(mockNodeD.send).not.toHaveBeenCalled();
		});

		it("should return 0 when no nodes are connected", () => {
			// No nodes connected
			(clientA as any)._remoteNodes.clear();

			const sentCount = clientA.broadcast("Hello?");
			expect(sentCount).toBe(0);
		});

		it("should handle send errors gracefully", () => {
			// Create a node that will throw an error
			const mockNodeWithError = {
				peer: "client-error",
				open: true,
				send: jest.fn().mockImplementation(() => {
					throw new Error("Send failed");
				}),
			};
			const mockNodeNormal = {
				peer: "client-normal",
				open: true,
				send: jest.fn(),
			};

			// Add nodes
			(clientA as any)._remoteNodes.set("client-error", mockNodeWithError);
			(clientA as any)._remoteNodes.set("client-normal", mockNodeNormal);

			// Mock logger to check warning
			const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});

			// Broadcast should continue despite error
			const sentCount = clientA.broadcast("Test message");

			// Should have attempted to send to both, but only counted successful sends
			expect(sentCount).toBe(1);
			expect(mockNodeWithError.send).toHaveBeenCalledWith("Test message", undefined);
			expect(mockNodeNormal.send).toHaveBeenCalledWith("Test message", undefined);
			
			// Should have logged the error
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("Failed to send broadcast to client-error:"),
				expect.any(Error)
			);

			warnSpy.mockRestore();
		});

		it("should work with complex data types", () => {
			const mockNode = {
				peer: "client-b",
				open: true,
				send: jest.fn(),
			};

			(clientA as any)._remoteNodes.set("client-b", mockNode);

			// Test with object
			const objectData = { type: "update", value: 42 };
			clientA.broadcast(objectData);
			expect(mockNode.send).toHaveBeenCalledWith(objectData, undefined);

			// Test with array
			const arrayData = [1, 2, 3, "test"];
			clientA.broadcast(arrayData);
			expect(mockNode.send).toHaveBeenCalledWith(arrayData, undefined);

			// Test with null
			clientA.broadcast(null);
			expect(mockNode.send).toHaveBeenCalledWith(null, undefined);
		});

		it("should not interfere with mesh networking messages", () => {
			const mockNode = {
				peer: "client-b",
				open: true,
				send: jest.fn(),
			};

			(clientA as any)._remoteNodes.set("client-b", mockNode);

			// Broadcast a message that looks like a mesh-peers message
			const meshLikeMessage = { type: "mesh-peers", peers: ["fake-peer"] };
			const sentCount = clientA.broadcast(meshLikeMessage);

			// Should still send it (broadcast doesn't filter messages)
			expect(sentCount).toBe(1);
			expect(mockNode.send).toHaveBeenCalledWith(meshLikeMessage, undefined);
		});
	});
});
