import { Peer, type SerializerMapping } from "./peer";
import { BinaryPack } from "./dataconnection/BufferedConnection/BinaryPack";

/**
 * @experimental
 * Uses BinaryPack serialization by default
 */
export class MsgPackPeer extends Peer {
	override _serializers: SerializerMapping = {
		default: BinaryPack,
	};
}
