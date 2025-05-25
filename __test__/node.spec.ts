import "./setup";
import { Node } from "../src/node";
import { Peer } from "../src/peer";
import { EventEmitter } from "events";
import { expect, beforeEach, describe, it, jest } from "@jest/globals";

// Mock DataConnection for testing - simplified version that doesn't use WebRTC
class MockDataConnection extends EventEmitter {
	readonly serialization = "mock";
	readonly peer: string;
	readonly provider: Peer;
	readonly node: Node;
	readonly connectionId: string;
	readonly metadata: any;
	readonly label: string;
	readonly reliable: boolean;

	_open = false;

	constructor(peer: string, provider: Peer, node: Node, options: any = {}) {
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

describe("Node", () => {
	let peer: Peer;
	let node: Node;
	let mockConnection1: MockDataConnection;
	let mockConnection2: MockDataConnection;

	beforeEach(() => {
		peer = new Peer();
		node = new Node("remote-peer-id", peer, { test: "metadata" });
		mockConnection1 = new MockDataConnection("remote-peer-id", peer, node, {
			connectionId: "conn1",
		});
		mockConnection2 = new MockDataConnection("remote-peer-id", peer, node, {
			connectionId: "conn2",
		});
	});

	afterEach(() => {
		if (node && !node.destroyed) {
			node.close();
		}
		if (peer && !peer.destroyed) {
			peer.destroy();
		}
	});

	describe("constructor", () => {
		it("should initialize with correct properties", () => {
			expect(node.peer).toBe("remote-peer-id");
			expect(node.metadata).toEqual({ test: "metadata" });
			expect(node.open).toBe(false);
			expect(node.destroyed).toBe(false);
			expect(node.connectionCount).toBe(0);
		});
	});

	describe("connection management", () => {
		it("should add connections and track count", () => {
			expect(node.connectionCount).toBe(0);

			node._addConnection(mockConnection1 as any);
			expect(node.connectionCount).toBe(1);

			node._addConnection(mockConnection2 as any);
			expect(node.connectionCount).toBe(2);
		});

		it("should not add duplicate connections", () => {
			node._addConnection(mockConnection1 as any);
			node._addConnection(mockConnection1 as any); // Same connection

			expect(node.connectionCount).toBe(1);
		});

		it("should not add connections to destroyed node", () => {
			node.close();

			const closeSpy = jest.spyOn(mockConnection1, "close");
			node._addConnection(mockConnection1 as any);

			expect(node.connectionCount).toBe(0);
			expect(closeSpy).toHaveBeenCalled();
		});

		it("should remove connections", () => {
			node._addConnection(mockConnection1 as any);
			node._addConnection(mockConnection2 as any);
			expect(node.connectionCount).toBe(2);

			node._removeConnection(mockConnection1 as any);
			expect(node.connectionCount).toBe(1);

			node._removeConnection(mockConnection2 as any);
			expect(node.connectionCount).toBe(0);
		});

		it("should auto-close when all connections are removed", () => {
			const closeSpy = jest.spyOn(node, "close");

			node._addConnection(mockConnection1 as any);
			node._removeConnection(mockConnection1 as any);

			expect(closeSpy).toHaveBeenCalled();
		});
	});

	describe("node state", () => {
		it("should become ready when a connection opens", () => {
			const openSpy = jest.fn();
			node.on("open", openSpy);

			node._addConnection(mockConnection1 as any);
			expect(node.open).toBe(false);
			expect(openSpy).not.toHaveBeenCalled();

			// Simulate connection opening
			mockConnection1._open = true;
			mockConnection1.emit("open");

			expect(node.open).toBe(true);
			expect(openSpy).toHaveBeenCalled();
		});

		it("should emit data events from connections", () => {
			const dataSpy = jest.fn();
			node.on("data", dataSpy);

			node._addConnection(mockConnection1 as any);
			mockConnection1.emit("data", "test-data");

			expect(dataSpy).toHaveBeenCalledWith("test-data");
		});

		it("should emit error events from connections", () => {
			const errorSpy = jest.fn();
			node.on("error", errorSpy);

			const testError = new Error("test error");
			node._addConnection(mockConnection1 as any);
			mockConnection1.emit("error", testError);

			expect(errorSpy).toHaveBeenCalledWith(testError);
		});
	});

	describe("sending data", () => {
		it("should send data through first open connection", () => {
			const sendSpy = jest.spyOn(mockConnection1, "send");

			node._addConnection(mockConnection1 as any);
			mockConnection1._open = true;
			// Make node open by simulating connection open
			mockConnection1.emit("open");

			node.send("test-data");
			expect(sendSpy).toHaveBeenCalledWith("test-data");
		});

		it("should emit error when no open connections available", () => {
			const errorSpy = jest.fn();
			node.on("error", errorSpy);

			node._addConnection(mockConnection1 as any);
			mockConnection1._open = true;
			// Make node open first
			mockConnection1.emit("open");
			// Then close the connection
			mockConnection1._open = false;

			node.send("test-data");
			expect(errorSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "NoOpenConnection",
				}),
			);
		});

		it("should emit error when node is not open", () => {
			const errorSpy = jest.fn();
			node.on("error", errorSpy);

			node.send("test-data");
			expect(errorSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "NotOpenYet",
				}),
			);
		});
	});

	describe("connection lookup", () => {
		it("should find connection by connectionId", () => {
			node._addConnection(mockConnection1 as any);
			node._addConnection(mockConnection2 as any);

			const found = node.getConnection("conn1");
			expect(found).toBe(mockConnection1);

			const notFound = node.getConnection("nonexistent");
			expect(notFound).toBeNull();
		});
	});

	describe("lost messages", () => {
		it("should store and retrieve lost messages", () => {
			const message1 = { type: "test", payload: "data1" };
			const message2 = { type: "test", payload: "data2" };

			node._storeMessage("conn1", message1 as any);
			node._storeMessage("conn1", message2 as any);

			const messages = node._getMessages("conn1");
			expect(messages).toEqual([message1, message2]);

			// Should be cleared after retrieval
			const messagesAgain = node._getMessages("conn1");
			expect(messagesAgain).toEqual([]);
		});

		it("should handle lost messages when adding connection", () => {
			const message = { type: "test", payload: "data" };
			const handleSpy = jest.spyOn(mockConnection1, "handleMessage");

			// Store message before connection exists
			node._storeMessage("conn1", message as any);

			// Add connection - should process stored messages
			node._addConnection(mockConnection1 as any);

			expect(handleSpy).toHaveBeenCalledWith(message);
		});

		it("should clean up lost messages when connection is removed", () => {
			const message = { type: "test", payload: "data" };

			node._storeMessage("conn1", message as any);
			node._addConnection(mockConnection1 as any);

			// Remove connection should clean up messages
			node._removeConnection(mockConnection1 as any);

			const messages = node._getMessages("conn1");
			expect(messages).toEqual([]);
		});
	});

	describe("connection deduplication", () => {
		it("should deduplicate connections when peer has larger ID", (done) => {
			// Mock peer ID to be larger than remote peer ID
			Object.defineProperty(peer, "id", { value: "z-larger-id" });

			const connection1 = new MockDataConnection("a-smaller-id", peer, node, {
				connectionId: "conn1",
			});
			const connection2 = new MockDataConnection("a-smaller-id", peer, node, {
				connectionId: "conn2",
			});

			const closeSpy1 = jest.spyOn(connection1, "close");
			const closeSpy2 = jest.spyOn(connection2, "close");

			// Make connections appear open
			connection1._open = true;
			connection2._open = true;

			node._addConnection(connection1 as any);
			node._addConnection(connection2 as any);

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
			Object.defineProperty(peer, "id", { value: "a-smaller-id" });

			const connection1 = new MockDataConnection("z-larger-id", peer, node, {
				connectionId: "conn1",
			});
			const connection2 = new MockDataConnection("z-larger-id", peer, node, {
				connectionId: "conn2",
			});

			const closeSpy1 = jest.spyOn(connection1, "close");
			const closeSpy2 = jest.spyOn(connection2, "close");

			// Make connections appear open
			connection1._open = true;
			connection2._open = true;

			node._addConnection(connection1 as any);
			node._addConnection(connection2 as any);

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
			node.on("close", closeSpy);

			const connCloseSpy1 = jest.spyOn(mockConnection1, "close");
			const connCloseSpy2 = jest.spyOn(mockConnection2, "close");

			node._addConnection(mockConnection1 as any);
			node._addConnection(mockConnection2 as any);

			node.close();

			expect(node.destroyed).toBe(true);
			expect(node.open).toBe(false);
			expect(node.connectionCount).toBe(0);
			expect(connCloseSpy1).toHaveBeenCalled();
			expect(connCloseSpy2).toHaveBeenCalled();
			expect(closeSpy).toHaveBeenCalled();
		});

		it("should remove node from provider when closed", () => {
			const removeNodeSpy = jest.spyOn(peer, "_removeNode");

			node.close();

			expect(removeNodeSpy).toHaveBeenCalledWith(node);
		});

		it("should not close if already destroyed", () => {
			const closeSpy = jest.fn();
			node.on("close", closeSpy);

			node.close();
			expect(closeSpy).toHaveBeenCalledTimes(1);

			node.close(); // Second call
			expect(closeSpy).toHaveBeenCalledTimes(1); // Should not be called again
		});

		it("should support disconnect alias", () => {
			const closeSpy = jest.spyOn(node, "close");

			node.disconnect();

			expect(closeSpy).toHaveBeenCalled();
		});
	});
});
