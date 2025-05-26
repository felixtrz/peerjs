import { util } from "./utils/utils";
import { MeshClient } from "./mesh-client";

(<any>window).peerjs = {
	Peer: MeshClient, // Keep Peer name for backwards compatibility
	util,
};
