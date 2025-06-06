import { EventEmitter } from "eventemitter3";
import logger from "../utils/logger";

export interface EventsWithError<ErrorType extends string> {
	error: (error: MeshClientError<`${ErrorType}`>) => void;
}

export class EventEmitterWithError<
	ErrorType extends string,
	Events extends EventsWithError<ErrorType>,
> extends EventEmitter<Events, never> {
	/**
	 * Emits a typed error message.
	 *
	 * @internal
	 */
	emitError(type: ErrorType, err: string | Error): void {
		logger.error("Error:", err);

		// @ts-ignore
		this.emit("error", new MeshClientError<`${ErrorType}`>(`${type}`, err));
	}
}
/**
 * A MeshClientError is emitted whenever an error occurs.
 * It always has a `.type`, which can be used to identify the error.
 */
export class MeshClientError<T extends string> extends Error {
	/**
	 * @internal
	 */
	constructor(type: T, err: Error | string) {
		if (typeof err === "string") {
			super(err);
		} else {
			super();
			Object.assign(this, err);
		}

		this.type = type;
	}

	public type: T;
}
