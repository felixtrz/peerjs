import { browser } from "@wdio/globals";

describe("Multi-Channel Simple Test", () => {
	it("should connect and send messages", async () => {
		// Open two windows
		await browser.url("/e2e/datachannel/multi-channel/multi-channel.html");
		await browser.newWindow("/e2e/datachannel/multi-channel/multi-channel.html");
		
		// Get window handles
		const handles = await browser.getWindowHandles();
		
		// Initialize peer 1
		await browser.switchToWindow(handles[0]);
		const id1 = await browser.executeAsync((done) => {
			// Use Peer which is the actual exported name in the bundle
			const { Peer } = window.peerjs;
			window.mesh = new Peer();
			window.messages = [];
			
			window.mesh.on("open", (id) => {
				done(id);
			});
			
			window.mesh.on("connection", (node) => {
				window.currentNode = node;
				node.on("data", (data) => {
					window.messages.push(data);
				});
			});
		});
		
		// Initialize peer 2
		await browser.switchToWindow(handles[1]);
		const id2 = await browser.executeAsync((done) => {
			const { Peer } = window.peerjs;
			window.mesh = new Peer();
			window.messages = [];
			
			window.mesh.on("open", (id) => {
				done(id);
			});
			
			window.mesh.on("connection", (node) => {
				window.currentNode = node;
				node.on("data", (data) => {
					window.messages.push(data);
				});
			});
		});
		
		console.log("Peer IDs:", { id1, id2 });
		
		// Wait a bit to ensure peers are fully initialized
		await browser.pause(1000);
		
		// Connect peer 1 to peer 2
		await browser.switchToWindow(handles[0]);
		await browser.executeAsync((peerId, done) => {
			try {
				const mesh = window.mesh;
				if (!mesh) {
					throw new Error("mesh is not defined");
				}
				
				// Debug mesh state
				console.log("Mesh state:", {
					disconnected: mesh.disconnected,
					destroyed: mesh.destroyed,
					id: mesh.id,
					connectionAttempts: mesh._connectionAttempts ? Array.from(mesh._connectionAttempts) : []
				});
				
				const node = mesh.connect(peerId);
				if (!node) {
					throw new Error(`mesh.connect returned undefined. Attempting to connect to: ${peerId}`);
				}
				window.currentNode = node;
				node.on("open", () => {
					done();
				});
				node.on("data", (data) => {
					window.messages.push(data);
				});
			} catch (error) {
				console.error("Connection error:", error.message);
				throw error;
			}
		}, id2);
		
		// Wait a bit for connection to establish on both sides
		await browser.pause(500);
		
		// Send a message with default reliability
		await browser.execute(() => {
			window.currentNode.send("Hello default");
		});
		
		// Send a reliable message
		await browser.execute(() => {
			window.currentNode.send("Hello reliable", { reliable: true });
		});
		
		// Send an unreliable message
		await browser.execute(() => {
			window.currentNode.send("Hello realtime", { reliable: false });
		});
		
		// Check messages received
		await browser.switchToWindow(handles[1]);
		await browser.waitUntil(
			async () => {
				const messages = await browser.execute(() => window.messages);
				return messages.length >= 3;
			},
			{
				timeout: 5000,
				timeoutMsg: "Messages not received"
			}
		);
		
		const receivedMessages = await browser.execute(() => window.messages);
		expect(receivedMessages).toContain("Hello default");
		expect(receivedMessages).toContain("Hello reliable");
		expect(receivedMessages).toContain("Hello realtime");
		
		// Wait a bit for channels to be established
		await browser.pause(500);
		
		// Check channel count on both sides
		await browser.switchToWindow(handles[0]);
		const channelCount1 = await browser.execute(() => {
			const node = window.currentNode;
			return node && node._channelMap ? node._channelMap.size : 0;
		});
		
		await browser.switchToWindow(handles[1]);
		const channelCount2 = await browser.execute(() => {
			const node = window.currentNode;
			return node && node._channelMap ? node._channelMap.size : 0;
		});
		
		console.log("Channel counts after peer1 sends:", { peer1: channelCount1, peer2: channelCount2 });
		
		// Peer2 should be able to send back using the same channels
		await browser.switchToWindow(handles[1]);
		await browser.execute(() => {
			window.currentNode.send("Reply default");
			window.currentNode.send("Reply reliable", { reliable: true });
			window.currentNode.send("Reply realtime", { reliable: false });
		});
		
		// Check peer1 received the replies
		await browser.switchToWindow(handles[0]);
		await browser.waitUntil(
			async () => {
				const messages = await browser.execute(() => window.messages);
				return messages.length >= 3;
			},
			{
				timeout: 5000,
				timeoutMsg: "Reply messages not received"
			}
		);
		
		// Check channel counts again
		const finalChannelCount1 = await browser.execute(() => {
			const node = window.currentNode;
			return node && node._channelMap ? node._channelMap.size : 0;
		});
		
		await browser.switchToWindow(handles[1]);
		const finalChannelCount2 = await browser.execute(() => {
			const node = window.currentNode;
			return node && node._channelMap ? node._channelMap.size : 0;
		});
		
		console.log("Final channel counts:", { peer1: finalChannelCount1, peer2: finalChannelCount2 });
		
		// Both should have 2 channels now
		expect(finalChannelCount1).toBe(2);
		expect(finalChannelCount2).toBe(2);
	});
});