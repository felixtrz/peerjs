import { browser } from "@wdio/globals";

export class MultiChannelPage {
	constructor(url = "/e2e/datachannel/multi-channel/multi-channel.html") {
		this.url = url;
	}

	async go() {
		await browser.url(this.url);
	}

	async init(options = {}) {
		// Only navigate if we're not already on the page
		const currentUrl = await browser.getUrl();
		if (!currentUrl.includes(this.url)) {
			await this.go();
		}
		
		await browser.executeAsync((opts, done) => {
			try {
				if (!window.peerjs) {
					throw new Error("PeerJS not loaded");
				}
				
				const { Peer } = window.peerjs;
				
				if (!Peer) {
					throw new Error("Peer not found in peerjs");
				}
				
				window.mesh = new Peer(null, {
					meshEnabled: opts.meshEnabled ?? true,
				});

			window.messages = [];
			window.internalMessages = [];
			window.consoleWarnings = [];
			window.lastUsedChannelType = null;
			window.channelCreationFailures = new Set();
			window.connectionOpen = false;

			// Override console.warn to capture warnings
			const originalWarn = console.warn;
			console.warn = (...args) => {
				window.consoleWarnings.push(args.join(" "));
				originalWarn(...args);
			};

			// Set up event handlers
			window.mesh.on("open", (id) => {
				window.meshId = id;
				done();
			});

			window.mesh.on("connection", (node) => {
				window.currentNode = node;
				
				// Wait for node to actually open before marking connection as open
				node.on("open", () => {
					window.connectionOpen = true;
				});
				
				node.on("data", (data) => {
					window.messages.push(data);
				});

				// Monitor internal messages if requested
				node.on("_internal_mesh_message", (data) => {
					window.internalMessages.push({
						type: data.type,
						channel: "reliable",
						data: data,
					});
				});
			});

			// Helper functions
			window.getChannelCount = () => {
				if (!window.currentNode) return 0;
				return window.currentNode._channelMap.size;
			};

			window.monitorChannelUsage = () => {
				if (!window.currentNode) return;
				
				const originalSend = window.currentNode.send;
				window.currentNode.send = function(data, options) {
					window.lastUsedChannelType = options?.reliable === false ? "realtime" : "reliable";
					return originalSend.call(this, data, options);
				};
			};
			} catch (error) {
				done({ error: error.message });
			}
		}, options);
	}

	async getId() {
		return await browser.execute(() => window.meshId);
	}

	async connect(peerId, options = {}) {
		await browser.execute((peerId, options) => {
			const node = window.mesh.connect(peerId, options);
			window.currentNode = node;
			
			// Set up monitoring
			if (window.monitorChannelUsage) {
				window.monitorChannelUsage();
			}
			
			node.on("open", () => {
				window.connectionOpen = true;
			});

			node.on("data", (data) => {
				window.messages.push(data);
			});
		}, peerId, options);
	}

	async waitForConnection() {
		// For the receiving peer, wait for the connection event
		await browser.waitUntil(
			async () => {
				const state = await browser.execute(() => {
					const node = window.currentNode;
					let connectionStates = [];
					if (node && node._connections) {
						connectionStates = node._connections.map((conn) => ({
							id: conn.connectionId,
							open: conn.open,
							type: conn.type,
							label: conn.label
						}));
					}
					return {
						connectionOpen: window.connectionOpen,
						hasNode: !!node,
						nodeOpen: node ? node.open : false,
						nodePeer: node ? node.peer : null,
						connectionCount: node ? node._connections.length : 0,
						connectionStates
					};
				});
				// Wait for either the node to be open OR connectionOpen flag
				// In the simple test, connectionOpen flag seems sufficient
				return state.connectionOpen && state.hasNode;
			},
			{
				timeout: 10000,
				timeoutMsg: "Connection did not open within 10 seconds"
			}
		);
		// Additional wait to ensure both sides are ready
		await browser.pause(100);
	}

	async sendMessage(message, options) {
		await browser.execute((message, options) => {
			const node = window.currentNode;
			if (!node) {
				throw new Error("No currentNode set");
			}
			// Check if we have any open connections
			const hasOpenConnection = node._connections && node._connections.some((conn) => conn.open);
			if (!hasOpenConnection) {
				throw new Error(`No open connections. Node state: ${JSON.stringify({
					open: node.open,
					peer: node.peer,
					connectionCount: node._connections ? node._connections.length : 0,
					connectionStates: node._connections ? node._connections.map((c) => ({id: c.connectionId, open: c.open})) : []
				})}`);
			}
			node.send(message, options);
		}, message, options);
	}

	async broadcast(message, options) {
		await browser.execute((message, options) => {
			window.mesh.broadcast(message, options);
		}, message, options);
	}

	async waitForMessage() {
		await browser.waitUntil(
			async () => {
				const msgCount = await browser.execute(() => window.messages.length);
				return msgCount > 0;
			},
			{
				timeout: 5000,
				timeoutMsg: "Message not received within 5 seconds"
			}
		);

		return await browser.execute(() => {
			return window.messages.shift() || "";
		});
	}

	async getChannelCount() {
		return await browser.execute(() => window.getChannelCount());
	}

	async getLastUsedChannelType() {
		return await browser.execute(() => window.lastUsedChannelType || "");
	}

	async getConsoleWarnings() {
		return await browser.execute(() => window.consoleWarnings);
	}

	async mockChannelCreationFailure(channelType) {
		await browser.execute((type) => {
			window.channelCreationFailures.add(type);
			
			// Override _getOrCreateChannel to simulate failure
			if (window.currentNode) {
				const original = window.currentNode._getOrCreateChannel;
				window.currentNode._getOrCreateChannel = function(channelType) {
					if (window.channelCreationFailures.has(channelType)) {
						return null;
					}
					return original.call(this, channelType);
				};
			}
		}, channelType);
	}

	async getInternalMessages() {
		return await browser.execute(() => window.internalMessages);
	}
}

// Export as default for the import style used in tests
export default {
	MultiChannelPage
};