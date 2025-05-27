import type { ServerMessageType } from "../utils/enums";

export class ServerMessage {
	type!: ServerMessageType;
	payload: any;
	src!: string;
}
