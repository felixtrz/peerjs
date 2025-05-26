import "./setup";
import { MeshClient, RemoteNode } from "../src";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import logger from "../src/utils/logger";

describe("Multi-Channel Support", () => {
	let mesh1: MeshClient;
	let mesh2: MeshClient;
	let node1: RemoteNode;

	beforeEach(() => {
		// Reset state before each test
		jest.clearAllMocks();
	});

	afterEach(() => {
		// Clean up
		if (mesh1) mesh1.destroy();
		if (mesh2) mesh2.destroy();
	});

	describe("Channel Options", () => {
		it("should pass reliability options through send", () => {
			mesh1 = new MeshClient("mesh1");
			
			// Create a mock node with a spy on send
			const sendSpy = jest.fn();
			const mockNode = {
				open: true,
				send: sendSpy,
				close: jest.fn(),
				peer: "peer1",
			};
			
			// Add the mock node
			(mesh1 as any)._remoteNodes.set("peer1", mockNode);
			
			// Test reliable broadcast
			mesh1.broadcast("test message", { reliable: true });
			expect(sendSpy).toHaveBeenCalledWith("test message", { reliable: true });
			
			// Test unreliable broadcast
			sendSpy.mockClear();
			mesh1.broadcast("test message", { reliable: false });
			expect(sendSpy).toHaveBeenCalledWith("test message", { reliable: false });
			
			// Test default broadcast (no options)
			sendSpy.mockClear();
			mesh1.broadcast("test message");
			expect(sendSpy).toHaveBeenCalledWith("test message", undefined);
		});
	});

	describe("RemoteNode Channel Management", () => {
		it("should determine default channel type based on connection options", () => {
			mesh1 = new MeshClient("mesh1");
			
			// Create node with reliable=true (default)
			const reliableNode = new RemoteNode("peer1", mesh1, {}, { reliable: true });
			expect((reliableNode as any)._defaultChannelType).toBe('reliable');
			
			// Create node with reliable=false
			const realtimeNode = new RemoteNode("peer2", mesh1, {}, { reliable: false });
			expect((realtimeNode as any)._defaultChannelType).toBe('realtime');
		});


		it("should call _getOrCreateChannel with correct channel type", () => {
			mesh1 = new MeshClient("mesh1");
			node1 = new RemoteNode("peer1", mesh1, {}, {});
			
			// Mock the _getOrCreateChannel method
			const getOrCreateChannelSpy = jest.spyOn(node1 as any, '_getOrCreateChannel').mockReturnValue({
				open: true,
				send: jest.fn(),
			});
			
			// Mark node as open
			(node1 as any)._open = true;
			
			// Send with reliable=true
			node1.send("test", { reliable: true });
			expect(getOrCreateChannelSpy).toHaveBeenCalledWith('reliable');
			
			// Send with reliable=false
			getOrCreateChannelSpy.mockClear();
			node1.send("test", { reliable: false });
			expect(getOrCreateChannelSpy).toHaveBeenCalledWith('realtime');
			
			// Send with no options (should use default)
			getOrCreateChannelSpy.mockClear();
			node1.send("test");
			expect(getOrCreateChannelSpy).toHaveBeenCalledWith('reliable');
		});

		it("should fallback to any open connection when specific channel unavailable", () => {
			mesh1 = new MeshClient("mesh1");
			node1 = new RemoteNode("peer1", mesh1, {}, {});
			
			// Mock _getOrCreateChannel to return null (channel unavailable)
			jest.spyOn(node1 as any, '_getOrCreateChannel').mockReturnValue(null);
			
			// Add a mock connection
			const mockConnection = {
				open: true,
				send: jest.fn(),
			};
			(node1 as any)._connections = [mockConnection];
			(node1 as any)._open = true;
			
			// Spy on logger
			const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
			
			// Try to send on realtime channel
			node1.send("test", { reliable: false });
			
			// Should use fallback connection and log warning
			expect(mockConnection.send).toHaveBeenCalledWith("test");
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Using fallback connection"));
			
			warnSpy.mockRestore();
		});
	});

	describe("Connection Deduplication with Channels", () => {
		it("should keep one connection per label during deduplication", async () => {
			mesh1 = new MeshClient("mesh1");
			node1 = new RemoteNode("peer1", mesh1, {}, {});
			
			// Create mock connections
			const reliableConn1 = {
				label: 'reliable',
				connectionId: 'rel1',
				open: true,
				close: jest.fn(),
			};
			
			const realtimeConn = {
				label: 'realtime',
				connectionId: 'rt1',
				open: true,
				close: jest.fn(),
			};
			
			const reliableConn2 = {
				label: 'reliable',
				connectionId: 'rel2',
				open: true,
				close: jest.fn(),
			};
			
			// Add connections
			(node1 as any)._connections = [reliableConn1, realtimeConn, reliableConn2];
			
			// Mock provider.id to trigger deduplication logic
			(mesh1 as any)._id = 'mesh1';
			
			// Trigger deduplication (only runs if our ID > peer ID)
			if ('mesh1' > 'peer1') {
				(node1 as any)._deduplicateConnections();
				
				// Wait for deduplication timeout
				await new Promise(resolve => setTimeout(resolve, 150));
				
				// Should keep first reliable and realtime, close second reliable
				expect(reliableConn1.close).not.toHaveBeenCalled();
				expect(realtimeConn.close).not.toHaveBeenCalled();
				expect(reliableConn2.close).toHaveBeenCalled();
			} else {
				// If our ID < peer ID, no deduplication happens
				expect(reliableConn1.close).not.toHaveBeenCalled();
				expect(realtimeConn.close).not.toHaveBeenCalled();
				expect(reliableConn2.close).not.toHaveBeenCalled();
			}
		});
	});

	describe("Channel Mapping", () => {
		it("should map connections to channels when label matches", () => {
			mesh1 = new MeshClient("mesh1");
			node1 = new RemoteNode("peer1", mesh1, {}, {});
			
			// Create mock connection with reliable label
			const mockConnection = {
				label: 'reliable',
				connectionId: 'test1',
				on: jest.fn(),
			};
			
			// Add connection
			(node1 as any)._addConnection(mockConnection);
			
			// Should be mapped to reliable channel
			expect((node1 as any)._channelMap.get('reliable')).toBe(mockConnection);
		});

		it("should remove from channel map when connection is removed", () => {
			mesh1 = new MeshClient("mesh1");
			node1 = new RemoteNode("peer1", mesh1, {}, {});
			
			// Create and add mock connection
			const mockConnection = {
				label: 'realtime',
				connectionId: 'test1',
				on: jest.fn(),
			};
			
			(node1 as any)._connections = [mockConnection];
			(node1 as any)._channelMap.set('realtime', mockConnection);
			
			// Mock _cleanupLostMessages to avoid errors
			jest.spyOn(node1 as any, '_cleanupLostMessages').mockImplementation(() => {});
			
			// Remove connection
			(node1 as any)._removeConnection(mockConnection);
			
			// Should be removed from channel map
			expect((node1 as any)._channelMap.has('realtime')).toBe(false);
			expect((node1 as any)._connections).not.toContain(mockConnection);
		});
	});

	describe("Mesh Handshake Reliability", () => {
		it("should send mesh handshakes with reliable option", () => {
			mesh1 = new MeshClient("mesh1");
			
			// Create a mock node
			const sendSpy = jest.fn();
			const mockNode = {
				peer: "peer1",
				send: sendSpy,
				on: jest.fn(),
				once: jest.fn(),
			};
			
			// Initialize handshake tracking
			(mesh1 as any)._meshHandshakes.set("peer1", {
				sent: false,
				received: false,
				retryCount: 0,
			});
			
			// Call _sendMeshHandshake
			(mesh1 as any)._sendMeshHandshake(mockNode);
			
			// Should send with reliable option
			expect(sendSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					__peerJSInternal: true,
					type: "mesh-peers",
				}),
				{ reliable: true }
			);
		});
	});
});