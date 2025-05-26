import "./setup";
import { RemoteNode } from "../src/mesh/node";
import { MeshClient } from "../src/mesh/client";
import { EventEmitter } from "events";
import { expect, beforeEach, describe, it, jest } from "@jest/globals";

// Mock DataConnection for testing - simplified version that doesn't use WebRTC
class MockDataConnection extends EventEmitter {
	readonly serialization = "mock";
	readonly peer: string;
	readonly provider: MeshClient;
	readonly node: RemoteNode;
	readonly connectionId: string;
	readonly metadata: any;
	readonly label: string;
	readonly reliable: boolean;
	peerConnection?: RTCPeerConnection;

	_open = false;

	constructor(
		peer: string,
		provider: MeshClient,
		node: RemoteNode,
		options: any = {},
	) {
		super();
		this.peer = peer;
		this.provider = provider;
		this.node = node;
		this.connectionId = options.connectionId || "test-connection-id";
		this.metadata = options.metadata;
		this.label = options.label || this.connectionId;
		this.reliable = !!options.reliable;
	}

	get open() {
		return this._open;
	}

	send(_data: any): void {
		// Mock implementation
	}

	close(): void {
		if (!this._open) return;
		this._open = false;
		this.emit("close");
	}

	handleMessage(_message: any): Promise<void> {
		return Promise.resolve();
	}
}

describe("RemoteNode", () => {
	let meshClient: MeshClient;
	let remoteNode: RemoteNode;
	let mockConnection1: MockDataConnection;
	let mockConnection2: MockDataConnection;

	beforeEach(() => {
		meshClient = new MeshClient();
		remoteNode = new RemoteNode("remote-peer-id", meshClient, {
			test: "metadata",
		});
		mockConnection1 = new MockDataConnection(
			"remote-peer-id",
			meshClient,
			remoteNode,
			{
				connectionId: "conn1",
			},
		);
		mockConnection2 = new MockDataConnection(
			"remote-peer-id",
			meshClient,
			remoteNode,
			{
				connectionId: "conn2",
			},
		);
	});

	afterEach(() => {
		// Ensure we're using real timers for cleanup
		jest.useRealTimers();

		if (remoteNode && !remoteNode.destroyed) {
			remoteNode.close();
		}
		if (meshClient && !meshClient.destroyed) {
			meshClient.destroy();
		}
	});

	describe("constructor", () => {
		it("should initialize with correct properties", () => {
			expect(remoteNode.peer).toBe("remote-peer-id");
			expect(remoteNode.metadata).toEqual({ test: "metadata" });
			expect(remoteNode.open).toBe(false);
			expect(remoteNode.destroyed).toBe(false);
			expect(remoteNode.connectionCount).toBe(0);
		});
	});

	describe("connection management", () => {
		it("should add connections and track count", () => {
			expect(remoteNode.connectionCount).toBe(0);

			remoteNode._addConnection(mockConnection1 as any);
			expect(remoteNode.connectionCount).toBe(1);

			remoteNode._addConnection(mockConnection2 as any);
			expect(remoteNode.connectionCount).toBe(2);
		});

		it("should not add duplicate connections", () => {
			remoteNode._addConnection(mockConnection1 as any);
			remoteNode._addConnection(mockConnection1 as any); // Same connection

			expect(remoteNode.connectionCount).toBe(1);
		});

		it("should not add connections to destroyed node", () => {
			remoteNode.close();

			const closeSpy = jest.spyOn(mockConnection1, "close");
			remoteNode._addConnection(mockConnection1 as any);

			expect(remoteNode.connectionCount).toBe(0);
			expect(closeSpy).toHaveBeenCalled();
		});

		it("should remove connections", () => {
			remoteNode._addConnection(mockConnection1 as any);
			remoteNode._addConnection(mockConnection2 as any);
			expect(remoteNode.connectionCount).toBe(2);

			remoteNode._removeConnection(mockConnection1 as any);
			expect(remoteNode.connectionCount).toBe(1);

			remoteNode._removeConnection(mockConnection2 as any);
			expect(remoteNode.connectionCount).toBe(0);
		});

		it("should auto-close when all connections are removed", () => {
			const closeSpy = jest.spyOn(remoteNode, "close");

			remoteNode._addConnection(mockConnection1 as any);
			remoteNode._removeConnection(mockConnection1 as any);

			expect(closeSpy).toHaveBeenCalled();
		});
	});

	describe("node state", () => {
		it("should become ready when a connection opens", () => {
			const openSpy = jest.fn();
			remoteNode.on("open", openSpy);

			remoteNode._addConnection(mockConnection1 as any);
			expect(remoteNode.open).toBe(false);
			expect(openSpy).not.toHaveBeenCalled();

			// Simulate connection opening
			mockConnection1._open = true;
			mockConnection1.emit("open");

			expect(remoteNode.open).toBe(true);
			expect(openSpy).toHaveBeenCalled();
		});

		it("should emit data events from connections", () => {
			const dataSpy = jest.fn();
			remoteNode.on("data", dataSpy);

			remoteNode._addConnection(mockConnection1 as any);
			mockConnection1.emit("data", "test-data");

			expect(dataSpy).toHaveBeenCalledWith("test-data");
		});

		it("should emit error events from connections", () => {
			const errorSpy = jest.fn();
			remoteNode.on("error", errorSpy);

			const testError = new Error("test error");
			remoteNode._addConnection(mockConnection1 as any);
			mockConnection1.emit("error", testError);

			expect(errorSpy).toHaveBeenCalledWith(testError);
		});
	});

	describe("sending data", () => {
		it("should send data through first open connection", () => {
			const sendSpy = jest.spyOn(mockConnection1, "send");

			remoteNode._addConnection(mockConnection1 as any);
			mockConnection1._open = true;
			// Make node open by simulating connection open
			mockConnection1.emit("open");

			remoteNode.send("test-data");
			expect(sendSpy).toHaveBeenCalledWith("test-data");
		});

		it("should emit error when no open connections available", () => {
			const errorSpy = jest.fn();
			remoteNode.on("error", errorSpy);

			remoteNode._addConnection(mockConnection1 as any);
			mockConnection1._open = true;
			// Make node open first
			mockConnection1.emit("open");
			// Then close the connection
			mockConnection1._open = false;

			remoteNode.send("test-data");
			expect(errorSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "NoOpenConnection",
				}),
			);
		});

		it("should emit error when node is not open", () => {
			const errorSpy = jest.fn();
			remoteNode.on("error", errorSpy);

			remoteNode.send("test-data");
			expect(errorSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "NotOpenYet",
				}),
			);
		});
	});

	describe("connection lookup", () => {
		it("should find connection by connectionId", () => {
			remoteNode._addConnection(mockConnection1 as any);
			remoteNode._addConnection(mockConnection2 as any);

			const found = remoteNode.getConnection("conn1");
			expect(found).toBe(mockConnection1);

			const notFound = remoteNode.getConnection("nonexistent");
			expect(notFound).toBeNull();
		});
	});

	describe("lost messages", () => {
		it("should store and retrieve lost messages", () => {
			const message1 = { type: "test", payload: "data1" };
			const message2 = { type: "test", payload: "data2" };

			remoteNode._storeMessage("conn1", message1 as any);
			remoteNode._storeMessage("conn1", message2 as any);

			const messages = remoteNode._getMessages("conn1");
			expect(messages).toEqual([message1, message2]);

			// Should be cleared after retrieval
			const messagesAgain = remoteNode._getMessages("conn1");
			expect(messagesAgain).toEqual([]);
		});

		it("should handle lost messages when adding connection", () => {
			const message = { type: "test", payload: "data" };
			const handleSpy = jest.spyOn(mockConnection1, "handleMessage");

			// Store message before connection exists
			remoteNode._storeMessage("conn1", message as any);

			// Add connection - should process stored messages
			remoteNode._addConnection(mockConnection1 as any);

			expect(handleSpy).toHaveBeenCalledWith(message);
		});

		it("should clean up lost messages when connection is removed", () => {
			const message = { type: "test", payload: "data" };

			remoteNode._storeMessage("conn1", message as any);
			remoteNode._addConnection(mockConnection1 as any);

			// Remove connection should clean up messages
			remoteNode._removeConnection(mockConnection1 as any);

			const messages = remoteNode._getMessages("conn1");
			expect(messages).toEqual([]);
		});
	});

	describe("connection deduplication", () => {
		it("should deduplicate connections when peer has larger ID", (done) => {
			// Mock peer ID to be larger than remote peer ID
			Object.defineProperty(meshClient, "id", { value: "z-larger-id" });

			const connection1 = new MockDataConnection(
				"a-smaller-id",
				meshClient,
				remoteNode,
				{
					connectionId: "conn1",
				},
			);
			const connection2 = new MockDataConnection(
				"a-smaller-id",
				meshClient,
				remoteNode,
				{
					connectionId: "conn2",
				},
			);

			const closeSpy1 = jest.spyOn(connection1, "close");
			const closeSpy2 = jest.spyOn(connection2, "close");

			// Make connections appear open
			connection1._open = true;
			connection2._open = true;

			remoteNode._addConnection(connection1 as any);
			remoteNode._addConnection(connection2 as any);

			// Simulate both connections opening (triggers deduplication)
			connection1.emit("open");
			connection2.emit("open");

			// Wait for deduplication timeout
			setTimeout(() => {
				// One connection should be closed (the one with larger connectionId)
				if ("conn1" > "conn2") {
					expect(closeSpy1).toHaveBeenCalled();
					expect(closeSpy2).not.toHaveBeenCalled();
				} else {
					expect(closeSpy1).not.toHaveBeenCalled();
					expect(closeSpy2).toHaveBeenCalled();
				}
				done();
			}, 150);
		});

		it("should not deduplicate when peer has smaller ID", (done) => {
			// Mock peer ID to be smaller than remote peer ID
			Object.defineProperty(meshClient, "id", { value: "a-smaller-id" });

			const connection1 = new MockDataConnection(
				"z-larger-id",
				meshClient,
				remoteNode,
				{
					connectionId: "conn1",
				},
			);
			const connection2 = new MockDataConnection(
				"z-larger-id",
				meshClient,
				remoteNode,
				{
					connectionId: "conn2",
				},
			);

			const closeSpy1 = jest.spyOn(connection1, "close");
			const closeSpy2 = jest.spyOn(connection2, "close");

			// Make connections appear open
			connection1._open = true;
			connection2._open = true;

			remoteNode._addConnection(connection1 as any);
			remoteNode._addConnection(connection2 as any);

			connection1.emit("open");
			connection2.emit("open");

			// Wait for potential deduplication timeout
			setTimeout(() => {
				// Neither connection should be closed
				expect(closeSpy1).not.toHaveBeenCalled();
				expect(closeSpy2).not.toHaveBeenCalled();
				done();
			}, 150);
		});
	});

	describe("closing", () => {
		it("should close all connections and emit close event", () => {
			const closeSpy = jest.fn();
			remoteNode.on("close", closeSpy);

			const connCloseSpy1 = jest.spyOn(mockConnection1, "close");
			const connCloseSpy2 = jest.spyOn(mockConnection2, "close");

			remoteNode._addConnection(mockConnection1 as any);
			remoteNode._addConnection(mockConnection2 as any);

			remoteNode.close();

			expect(remoteNode.destroyed).toBe(true);
			expect(remoteNode.open).toBe(false);
			expect(remoteNode.connectionCount).toBe(0);
			expect(connCloseSpy1).toHaveBeenCalled();
			expect(connCloseSpy2).toHaveBeenCalled();
			expect(closeSpy).toHaveBeenCalled();
		});

		it("should remove node from provider when closed", () => {
			const removeNodeSpy = jest.spyOn(meshClient as any, "_removeNode");

			remoteNode.close();

			expect(removeNodeSpy).toHaveBeenCalledWith(remoteNode.peer);
		});

		it("should not close if already destroyed", () => {
			const closeSpy = jest.fn();
			remoteNode.on("close", closeSpy);

			remoteNode.close();
			expect(closeSpy).toHaveBeenCalledTimes(1);

			remoteNode.close(); // Second call
			expect(closeSpy).toHaveBeenCalledTimes(1); // Should not be called again
		});

		it("should support disconnect alias", () => {
			const closeSpy = jest.spyOn(remoteNode, "close");

			remoteNode.disconnect();

			expect(closeSpy).toHaveBeenCalled();
		});
	});

	describe("ping monitoring", () => {
		let mockPeerConnection: any;

		beforeEach(() => {
			// Mock RTCPeerConnection and its getStats method
			mockPeerConnection = {
				getStats: jest.fn(),
				iceConnectionState: "connected",
			};
		});

		it("should start with null ping", () => {
			expect(remoteNode.ping).toBeNull();
		});

		it("should start ping monitoring when node opens", () => {
			const pingStartSpy = jest.spyOn(
				remoteNode as any,
				"_startPingMonitoring",
			);

			// Add connection with peerConnection
			mockConnection1.peerConnection = mockPeerConnection;
			remoteNode._addConnection(mockConnection1 as any);
			mockConnection1._open = true;
			mockConnection1.emit("open");

			expect(pingStartSpy).toHaveBeenCalled();
		});

		it("should measure ping using RTCPeerConnection stats", async () => {
			const mockStats = new Map();
			mockStats.set("candidate-pair-1", {
				type: "candidate-pair",
				state: "succeeded",
				currentRoundTripTime: 0.025, // 25ms
			});
			mockPeerConnection.getStats.mockResolvedValue(mockStats);

			const pingSpy = jest.fn();
			remoteNode.on("ping", pingSpy);

			// Add connection and simulate it opening
			mockConnection1.peerConnection = mockPeerConnection;
			mockConnection1._open = true;
			remoteNode._addConnection(mockConnection1 as any);
			mockConnection1.emit("open");

			// Wait for async ping measurement
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(mockPeerConnection.getStats).toHaveBeenCalled();
			expect(pingSpy).toHaveBeenCalledWith(25);
			expect(remoteNode.ping).toBe(25);
		});

		it("should average multiple RTT measurements", async () => {
			const mockStats = new Map();
			mockStats.set("candidate-pair-1", {
				type: "candidate-pair",
				state: "succeeded",
				currentRoundTripTime: 0.02, // 20ms
			});
			mockStats.set("candidate-pair-2", {
				type: "candidate-pair",
				state: "succeeded",
				currentRoundTripTime: 0.03, // 30ms
			});
			mockPeerConnection.getStats.mockResolvedValue(mockStats);

			const pingSpy = jest.fn();
			remoteNode.on("ping", pingSpy);

			// Add connection and simulate it opening
			mockConnection1.peerConnection = mockPeerConnection;
			mockConnection1._open = true;
			remoteNode._addConnection(mockConnection1 as any);
			mockConnection1.emit("open");

			// Wait for async ping measurement
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(pingSpy).toHaveBeenCalledWith(25); // Average of 20 and 30
			expect(remoteNode.ping).toBe(25);
		});

		it("should handle getStats errors gracefully", async () => {
			mockPeerConnection.getStats.mockRejectedValue(new Error("Stats failed"));

			const errorSpy = jest
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const pingSpy = jest.fn();
			remoteNode.on("ping", pingSpy);

			// Add connection and simulate it opening
			mockConnection1.peerConnection = mockPeerConnection;
			mockConnection1._open = true;
			remoteNode._addConnection(mockConnection1 as any);
			mockConnection1.emit("open");

			// Wait for async ping measurement
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(pingSpy).not.toHaveBeenCalled();
			expect(remoteNode.ping).toBeNull();

			errorSpy.mockRestore();
		});

		it("should stop ping monitoring when node closes", () => {
			jest.useFakeTimers();
			const clearIntervalSpy = jest.spyOn(global, "clearInterval");

			// Add connection and start monitoring
			mockConnection1.peerConnection = mockPeerConnection;
			mockConnection1._open = true;
			remoteNode._addConnection(mockConnection1 as any);
			mockConnection1.emit("open");

			// Close the node
			remoteNode.close();

			expect(clearIntervalSpy).toHaveBeenCalled();

			jest.useRealTimers();
		});

		it("should update ping periodically", async () => {
			jest.useFakeTimers();

			const mockStats = new Map();
			mockStats.set("candidate-pair-1", {
				type: "candidate-pair",
				state: "succeeded",
				currentRoundTripTime: 0.025,
			});
			mockPeerConnection.getStats.mockResolvedValue(mockStats);

			const pingSpy = jest.fn();
			remoteNode.on("ping", pingSpy);

			// Add connection and simulate it opening
			mockConnection1.peerConnection = mockPeerConnection;
			mockConnection1._open = true;
			remoteNode._addConnection(mockConnection1 as any);
			mockConnection1.emit("open");

			// Initial ping
			await Promise.resolve();
			expect(pingSpy).toHaveBeenCalledTimes(1);

			// Fast-forward 5 seconds
			jest.advanceTimersByTime(5000);
			await Promise.resolve();

			// Should have measured ping again
			expect(pingSpy).toHaveBeenCalledTimes(2);

			// Clean up before switching back to real timers
			remoteNode.close();

			jest.useRealTimers();
		});
	});

	describe("ping monitoring edge cases", () => {
		let mockPeerConnection: any;
		let remoteNode: RemoteNode;
		let meshClient: MeshClient;
		let mockConnection1: MockDataConnection;
		let mockConnection2: MockDataConnection;

		beforeEach(() => {
			// Mock RTCPeerConnection and its getStats method
			mockPeerConnection = {
				getStats: jest.fn(),
				iceConnectionState: "connected",
			};

			meshClient = new MeshClient();
			remoteNode = new RemoteNode("remote-peer-id", meshClient, {
				test: "metadata",
			});
			mockConnection1 = new MockDataConnection(
				"remote-peer-id",
				meshClient,
				remoteNode,
				{
					connectionId: "conn1",
				},
			);
			mockConnection2 = new MockDataConnection(
				"remote-peer-id",
				meshClient,
				remoteNode,
				{
					connectionId: "conn2",
				},
			);
		});

		afterEach(() => {
			// Don't close nodes here as they may not have started monitoring
		});

		it("should not measure ping if no open connections", async () => {
			const pingSpy = jest.fn();
			remoteNode.on("ping", pingSpy);

			// Add connection but don't open it
			mockConnection1.peerConnection = mockPeerConnection;
			mockConnection1._open = false;
			remoteNode._addConnection(mockConnection1 as any);

			// Try to measure ping directly
			await (remoteNode as any)._measurePing();

			expect(mockPeerConnection.getStats).not.toHaveBeenCalled();
			expect(pingSpy).not.toHaveBeenCalled();
			expect(remoteNode.ping).toBeNull();
		});

		it("should use the first open connection with peerConnection for ping", async () => {
			const mockStats = new Map();
			mockStats.set("candidate-pair-1", {
				type: "candidate-pair",
				state: "succeeded",
				currentRoundTripTime: 0.03,
			});
			mockPeerConnection.getStats.mockResolvedValue(mockStats);

			// Add first connection without peerConnection
			mockConnection1._open = true;
			remoteNode._addConnection(mockConnection1 as any);

			// Add second connection with peerConnection
			mockConnection2.peerConnection = mockPeerConnection;
			mockConnection2._open = true;
			remoteNode._addConnection(mockConnection2 as any);

			// Trigger ping measurement directly without opening node
			await (remoteNode as any)._measurePing();

			expect(mockPeerConnection.getStats).toHaveBeenCalled();
			expect(remoteNode.ping).toBe(30);
		});

		it("should ignore candidate pairs that are not succeeded", async () => {
			const mockStats = new Map();
			mockStats.set("candidate-pair-1", {
				type: "candidate-pair",
				state: "failed",
				currentRoundTripTime: 0.1,
			});
			mockStats.set("candidate-pair-2", {
				type: "candidate-pair",
				state: "succeeded",
				currentRoundTripTime: 0.02,
			});
			mockStats.set("candidate-pair-3", {
				type: "candidate-pair",
				state: "in-progress",
				currentRoundTripTime: 0.05,
			});
			mockPeerConnection.getStats.mockResolvedValue(mockStats);

			const pingSpy = jest.fn();
			remoteNode.on("ping", pingSpy);

			// Add connection but don't trigger node open to avoid starting monitoring
			mockConnection1.peerConnection = mockPeerConnection;
			mockConnection1._open = true;
			remoteNode._addConnection(mockConnection1 as any);

			// Measure ping directly
			await (remoteNode as any)._measurePing();

			// Should only use the succeeded candidate pair
			expect(pingSpy).toHaveBeenCalledWith(20);
			expect(remoteNode.ping).toBe(20);
		});

		it("should handle stats without RTT gracefully", async () => {
			const mockStats = new Map();
			mockStats.set("candidate-pair-1", {
				type: "candidate-pair",
				state: "succeeded",
				// No currentRoundTripTime property
			});
			mockStats.set("other-stat", {
				type: "inbound-rtp",
				// Other stat type
			});
			mockPeerConnection.getStats.mockResolvedValue(mockStats);

			const pingSpy = jest.fn();
			remoteNode.on("ping", pingSpy);

			// Add connection but don't trigger node open to avoid starting monitoring
			mockConnection1.peerConnection = mockPeerConnection;
			mockConnection1._open = true;
			remoteNode._addConnection(mockConnection1 as any);

			// Measure ping directly
			await (remoteNode as any)._measurePing();

			// Should not emit ping if no valid RTT found
			expect(pingSpy).not.toHaveBeenCalled();
			expect(remoteNode.ping).toBeNull();
		});

		it("should not start duplicate ping monitoring", () => {
			jest.useFakeTimers();
			const setIntervalSpy = jest.spyOn(global, "setInterval");

			// Start monitoring directly
			(remoteNode as any)._startPingMonitoring();

			const callCount = setIntervalSpy.mock.calls.length;

			// Try to start monitoring again
			(remoteNode as any)._startPingMonitoring();

			// Should not create another interval
			expect(setIntervalSpy).toHaveBeenCalledTimes(callCount);

			// Clean up
			(remoteNode as any)._stopPingMonitoring();

			jest.useRealTimers();
		});
	});
});
