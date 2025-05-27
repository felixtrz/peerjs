import { util } from "../utils/utils";
import logger from "../utils/logger";
import type { MeshClientJSOption } from "../options";
import { VERSION } from "../version";

export class API {
	constructor(private readonly _options: MeshClientJSOption) {}

	private _buildRequest(method: string): Promise<Response> {
		const protocol = this._options.secure ? "https" : "http";
		const { host, port, path } = this._options;
		const key = "peerjs"; // Default key, can be overridden in options
		const url = new URL(`${protocol}://${host}:${port}${path}${key}/${method}`);
		// TODO: Why timestamp, why random?
		url.searchParams.set("ts", `${Date.now()}${Math.random()}`);
		url.searchParams.set("version", VERSION);
		return fetch(url.href, {
			referrerPolicy: this._options.referrerPolicy,
		});
	}

	/** Get a unique ID from the server via XHR and initialize with it. */
	async retrieveId(): Promise<string> {
		try {
			const response = await this._buildRequest("id");

			if (response.status !== 200) {
				throw new Error(`Error. Status:${response.status}`);
			}

			return response.text();
		} catch (error) {
			logger.error("Error retrieving ID", error);

			let pathError = "";

			if (
				this._options.path === "/" &&
				this._options.host !== util.CLOUD_HOST
			) {
				pathError =
					" If you passed in a `path` to your self-hosted PeerServer, " +
					"you'll also need to pass in that same path when creating a new " +
					"Peer.";
			}

			throw new Error("Could not get an ID from the server." + pathError);
		}
	}
}
