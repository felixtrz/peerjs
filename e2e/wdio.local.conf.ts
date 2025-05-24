import { config as sharedConfig } from "./wdio.shared.conf.js";

export const config: WebdriverIO.Config = {
	runner: "local",
	...sharedConfig,
	...{
		capabilities: [
			{
				browserName: "chrome",
				"goog:chromeOptions": {
					args: ["headless", "disable-gpu"],
				},
			},
		],
	},
};
