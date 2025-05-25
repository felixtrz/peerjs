import webRTCAdapter_import from "webrtc-adapter";

const webRTCAdapter: typeof webRTCAdapter_import =
	//@ts-ignore
	webRTCAdapter_import.default || webRTCAdapter_import;

export const Supports = new (class {
	readonly isIOS =
		typeof navigator !== "undefined"
			? ["iPad", "iPhone", "iPod"].includes(navigator.platform)
			: false;
	readonly supportedBrowsers = ["firefox", "chrome", "safari"];

	readonly minFirefoxVersion = 59;
	readonly minChromeVersion = 72;
	readonly minSafariVersion = 605;

	isWebRTCSupported(): boolean {
		return typeof RTCPeerConnection !== "undefined";
	}

	isBrowserSupported(): boolean {
		const browser = this.getBrowser();
		const version = this.getVersion();

		const validBrowser = this.supportedBrowsers.includes(browser);

		if (!validBrowser) return false;

		if (browser === "chrome") return version >= this.minChromeVersion;
		if (browser === "firefox") return version >= this.minFirefoxVersion;
		if (browser === "safari")
			return !this.isIOS && version >= this.minSafariVersion;

		return false;
	}

	getBrowser(): string {
		return webRTCAdapter.browserDetails.browser;
	}

	getVersion(): number {
		return webRTCAdapter.browserDetails.version || 0;
	}

	toString(): string {
		return `Supports:
    browser:${this.getBrowser()}
    version:${this.getVersion()}
    isIOS:${this.isIOS}
    isWebRTCSupported:${this.isWebRTCSupported()}
    isBrowserSupported:${this.isBrowserSupported()}`;
	}
})();
