import { browser } from "@wdio/globals";

export class MultiChannelPage {
	private url: string;

	constructor(url = "/e2e/datachannel/multi-channel.html") {
		this.url = url;
	}

	async go() {
		await browser.url(this.url);
	}

	async init(
		options: {
			meshEnabled?: boolean;
		} = {},
	) {
		// Only navigate if we're not already on the page
		const currentUrl = await browser.getUrl();
		if (!currentUrl.includes(this.url)) {
			await this.go();
		}

		await browser.executeAsync((opts: any, done: (result?: any) => void) => {
			try {
				if (!(window as any).linkt) {
					throw new Error("PeerJS not loaded");
				}

				const { MeshClient } = (window as any).linkt;

				if (!MeshClient) {
					throw new Error("MeshClient not found in linkt");
				}

				(window as any).mesh = new MeshClient(null, {
					meshEnabled: opts.meshEnabled ?? true,
				});

				(window as any).messages = [];
				(window as any).internalMessages = [];
				(window as any).consoleWarnings = [];
				(window as any).lastUsedChannelType = null;
				(window as any).channelCreationFailures = new Set();
				(window as any).connectionOpen = false;

				// Override console.warn to capture warnings
				const originalWarn = console.warn;
				console.warn = (...args: any[]) => {
					(window as any).consoleWarnings.push(args.join(" "));
					originalWarn(...args);
				};

				// Set up event handlers
				(window as any).mesh.on("open", (id: string) => {
					(window as any).meshId = id;
					done();
				});

				(window as any).mesh.on("connection", (node: any) => {
					(window as any).currentNode = node;

					// Wait for node to actually open before marking connection as open
					node.on("open", () => {
						(window as any).connectionOpen = true;
					});

					node.on("data", (data: any) => {
						(window as any).messages.push(data);
					});

					// Monitor internal messages if requested
					node.on("_internal_mesh_message", (data: any) => {
						(window as any).internalMessages.push({
							type: data.type,
							channel: "reliable",
							data: data,
						});
					});
				});

				// Helper functions
				(window as any).getChannelCount = () => {
					if (!(window as any).currentNode) return 0;
					return (window as any).currentNode._channelMap.size;
				};

				(window as any).monitorChannelUsage = () => {
					if (!(window as any).currentNode) return;

					const originalSend = (window as any).currentNode.send;
					(window as any).currentNode.send = function (
						data: any,
						options: any,
					) {
						(window as any).lastUsedChannelType =
							options?.reliable === false ? "realtime" : "reliable";
						return originalSend.call(this, data, options);
					};
				};
			} catch (error: any) {
				done({ error: error.message });
			}
		}, options);
	}

	async getId(): Promise<string> {
		return await browser.execute(() => (window as any).meshId);
	}

	async connect(
		peerId: string,
		options: { reliable?: boolean } = {},
	): Promise<void> {
		await browser.execute(
			(peerId: string, options: any) => {
				const node = (window as any).mesh.connect(peerId, options);
				(window as any).currentNode = node;

				// Set up monitoring
				if ((window as any).monitorChannelUsage) {
					(window as any).monitorChannelUsage();
				}

				node.on("open", () => {
					(window as any).connectionOpen = true;
				});

				node.on("data", (data: any) => {
					(window as any).messages.push(data);
				});
			},
			peerId,
			options,
		);
	}

	async waitForConnection(): Promise<void> {
		// For the receiving peer, wait for the connection event
		await browser.waitUntil(
			async () => {
				const state = await browser.execute(() => {
					const node = (window as any).currentNode;
					let connectionStates = [];
					if (node && node._connections) {
						connectionStates = node._connections.map((conn: any) => ({
							id: conn.connectionId,
							open: conn.open,
							type: conn.type,
							label: conn.label,
						}));
					}
					return {
						connectionOpen: (window as any).connectionOpen,
						hasNode: !!node,
						nodeOpen: node ? node.open : false,
						nodePeer: node ? node.peer : null,
						connectionCount: node ? node._connections.length : 0,
						connectionStates,
					};
				});
				// Wait for either the node to be open OR connectionOpen flag
				// In the simple test, connectionOpen flag seems sufficient
				return state.connectionOpen && state.hasNode;
			},
			{
				timeout: 10000,
				timeoutMsg: "Connection did not open within 10 seconds",
			},
		);
		// Additional wait to ensure both sides are ready
		await browser.pause(100);
	}

	async sendMessage(
		message: string,
		options?: { reliable?: boolean },
	): Promise<void> {
		await browser.execute(
			(message: string, options: any) => {
				const node = (window as any).currentNode;
				if (!node) {
					throw new Error("No currentNode set");
				}
				// Check if we have any open connections
				const hasOpenConnection =
					node._connections && node._connections.some((conn: any) => conn.open);
				if (!hasOpenConnection) {
					throw new Error(
						`No open connections. Node state: ${JSON.stringify({
							open: node.open,
							peer: node.peer,
							connectionCount: node._connections ? node._connections.length : 0,
							connectionStates: node._connections
								? node._connections.map((c: any) => ({
										id: c.connectionId,
										open: c.open,
									}))
								: [],
						})}`,
					);
				}
				node.send(message, options);
			},
			message,
			options,
		);
	}

	async broadcast(
		message: string,
		options?: { reliable?: boolean },
	): Promise<void> {
		await browser.execute(
			(message: string, options: any) => {
				(window as any).mesh.broadcast(message, options);
			},
			message,
			options,
		);
	}

	async waitForMessage(): Promise<string> {
		await browser.waitUntil(
			async () => {
				const msgCount = await browser.execute(
					() => (window as any).messages.length,
				);
				return msgCount > 0;
			},
			{
				timeout: 5000,
				timeoutMsg: "Message not received within 5 seconds",
			},
		);

		return await browser.execute(() => {
			return (window as any).messages.shift() || "";
		});
	}

	async getChannelCount(): Promise<number> {
		return await browser.execute(() => (window as any).getChannelCount());
	}

	async getLastUsedChannelType(): Promise<string> {
		return await browser.execute(
			() => (window as any).lastUsedChannelType || "",
		);
	}

	async getConsoleWarnings(): Promise<string[]> {
		return await browser.execute(() => (window as any).consoleWarnings);
	}

	async mockChannelCreationFailure(channelType: string): Promise<void> {
		await browser.execute((type: string) => {
			(window as any).channelCreationFailures.add(type);

			// Override _getOrCreateChannel to simulate failure
			if ((window as any).currentNode) {
				const original = (window as any).currentNode._getOrCreateChannel;
				(window as any).currentNode._getOrCreateChannel = function (
					channelType: any,
				) {
					if ((window as any).channelCreationFailures.has(channelType)) {
						return null;
					}
					return original.call(this, channelType);
				};
			}
		}, channelType);
	}

	async getInternalMessages(): Promise<
		Array<{ type: string; channel: string; data: any }>
	> {
		return await browser.execute(() => (window as any).internalMessages);
	}
}

// Export as default for the import style used in tests
export default {
	MultiChannelPage,
};
