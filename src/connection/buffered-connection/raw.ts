import { BufferedConnection } from "./buffered-connection";
import { SerializationType } from "../../utils/enums";

export class Raw extends BufferedConnection {
	readonly serialization = SerializationType.None;

	protected _handleDataMessage({ data }) {
		super.emit("data", data);
	}

	override _send(data, _chunked) {
		this._bufferedSend(data);
	}
}
