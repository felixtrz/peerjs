import { util } from "./utils/utils";
import { Peer } from "./peer";

(<any>window).peerjs = {
	Peer,
	util,
};
