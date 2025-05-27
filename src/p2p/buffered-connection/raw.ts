import { BufferedConnection } from "./buffered-connection";
import { SerializationType } from "../../utils/enums";

export class Raw extends BufferedConnection {
	readonly serialization = SerializationType.None;

	protected _handleDataMessage({ data }: { data: any }) {
		super.emit("data", data);
	}

	override _send(data: any, _chunked: boolean): void {
		this._bufferedSend(data);
	}
}
