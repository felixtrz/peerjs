import P from "./multi-channel.page.js";
import { browser } from "@wdio/globals";

describe("Multi-Channel Support", () => {
	it("should send messages via reliable and realtime channels", async () => {
		// Open two windows
		await browser.url("/e2e/datachannel/multi-channel.html");
		await browser.newWindow("/e2e/datachannel/multi-channel.html");

		// Get window handles
		const handles = await browser.getWindowHandles();

		// Initialize peer 1
		await browser.switchToWindow(handles[0]);
		await browser.executeAsync((done: (id: string) => void) => {
			const { MeshClient } = (window as any).linkt;
			(window as any).mesh = new MeshClient();
			(window as any).messages = [];

			(window as any).mesh.on("open", (id: string) => {
				done(id);
			});

			(window as any).mesh.on("connection", (node: any) => {
				(window as any).currentNode = node;
				node.on("data", (data: any) => {
					(window as any).messages.push(data);
				});
			});
		});

		// Initialize peer 2
		await browser.switchToWindow(handles[1]);
		const id2 = await browser.executeAsync((done: (id: string) => void) => {
			const { MeshClient } = (window as any).linkt;
			(window as any).mesh = new MeshClient();
			(window as any).messages = [];

			(window as any).mesh.on("open", (id: string) => {
				done(id);
			});

			(window as any).mesh.on("connection", (node: any) => {
				(window as any).currentNode = node;
				node.on("data", (data: any) => {
					(window as any).messages.push(data);
				});
			});
		});

		// Connect peer 1 to peer 2
		await browser.switchToWindow(handles[0]);
		await browser.executeAsync((peerId: string, done: () => void) => {
			const node = (window as any).mesh.connect(peerId, { reliable: true });
			(window as any).currentNode = node;
			node.on("open", () => {
				done();
			});
		}, id2);

		// Wait for connection to establish
		await browser.pause(500);

		// Send reliable message
		await browser.execute(() => {
			(window as any).currentNode.send("Hello reliable", { reliable: true });
		});

		// Send realtime message (should create new channel)
		await browser.execute(() => {
			(window as any).currentNode.send("Hello realtime", { reliable: false });
		});

		// Check messages received
		await browser.switchToWindow(handles[1]);
		await browser.waitUntil(
			async () => {
				const messages = await browser.execute(() => (window as any).messages);
				return messages.length >= 2;
			},
			{
				timeout: 5000,
				timeoutMsg: "Messages not received",
			},
		);

		const receivedMessages = await browser.execute(
			() => (window as any).messages,
		);
		expect(receivedMessages).toContain("Hello reliable");
		expect(receivedMessages).toContain("Hello realtime");

		// Wait a bit for channels to be created
		await browser.pause(1000);

		// Check channel counts
		await browser.switchToWindow(handles[0]);
		const info1 = await browser.execute(() => {
			const node = (window as any).currentNode;
			if (!node) return { count: 0, hasNode: false };
			return {
				count: node._channelMap ? node._channelMap.size : 0,
				hasNode: true,
				channels: node._channelMap ? Array.from(node._channelMap.keys()) : [],
			};
		});

		await browser.switchToWindow(handles[1]);
		const info2 = await browser.execute(() => {
			const node = (window as any).currentNode;
			if (!node) return { count: 0, hasNode: false };
			return {
				count: node._channelMap ? node._channelMap.size : 0,
				hasNode: true,
				channels: node._channelMap ? Array.from(node._channelMap.keys()) : [],
			};
		});

		console.log("Channel info:", { peer1: info1, peer2: info2 });

		// Peer1 should have created both channels when sending
		expect(info1.count).toBe(2);
		// Peer2 also has both channels mapped when it receives them
		expect(info2.count).toBe(2);

		// Have peer2 send back to create its channels
		await browser.switchToWindow(handles[1]);
		await browser.execute(() => {
			(window as any).currentNode.send("Reply reliable", { reliable: true });
			(window as any).currentNode.send("Reply realtime", { reliable: false });
		});

		await browser.pause(500);

		// Now check again - both should have 2 channels
		const finalInfo2 = await browser.execute(() => {
			const node = (window as any).currentNode;
			if (!node) return { count: 0, hasNode: false };
			return {
				count: node._channelMap ? node._channelMap.size : 0,
				hasNode: true,
				channels: node._channelMap ? Array.from(node._channelMap.keys()) : [],
			};
		});

		console.log("Final peer2 info:", finalInfo2);
		expect(finalInfo2.count).toBe(2);
	});

	xit("should broadcast with channel selection", async () => {
		const page1 = new P.MultiChannelPage();
		const page2 = new P.MultiChannelPage();
		const page3 = new P.MultiChannelPage();

		await page1.init();
		await page2.init();
		await page3.init();

		const id2 = await page2.getId();
		const id3 = await page3.getId();

		// Create mesh: page1 <-> page2 <-> page3
		await page1.connect(id2);
		await page2.connect(id3);
		await page2.waitForConnection();
		await page3.waitForConnection();

		// Wait for mesh to establish
		await browser.pause(1000);

		// Broadcast reliable message
		await page2.broadcast("Broadcast reliable", { reliable: true });

		const msg1 = await page1.waitForMessage();
		const msg3 = await page3.waitForMessage();
		expect(msg1).toBe("Broadcast reliable");
		expect(msg3).toBe("Broadcast reliable");

		// Broadcast realtime message
		await page2.broadcast("Broadcast realtime", { reliable: false });

		const msg1b = await page1.waitForMessage();
		const msg3b = await page3.waitForMessage();
		expect(msg1b).toBe("Broadcast realtime");
		expect(msg3b).toBe("Broadcast realtime");
	});

	xit("should fallback when channel creation fails", async () => {
		const page1 = new P.MultiChannelPage();
		const page2 = new P.MultiChannelPage();

		await page1.init();
		await page2.init();

		const id2 = await page2.getId();

		// Connect with reliable only
		await page1.connect(id2, { reliable: true });
		await page2.waitForConnection();

		// Mock channel creation failure
		await page1.mockChannelCreationFailure("realtime");

		// Try to send unreliable message
		await page1.sendMessage("Fallback message", { reliable: false });

		// Should still receive via reliable channel
		const msg = await page2.waitForMessage();
		expect(msg).toBe("Fallback message");

		// Check for warning
		const warnings = await page1.getConsoleWarnings();
		expect(warnings.some((w: string) => w.includes("fallback"))).toBe(true);
	});
});
