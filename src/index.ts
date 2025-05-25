export { util, type Util } from "./utils/utils";
import { MeshClient } from "./mesh-client";

export type { MeshClientEvents, MeshClientOptions } from "./mesh-client";

export type { MeshClientJSOption, MeshClientConnectOption, AnswerOption } from "./options";
export type { UtilSupportsObj } from "./utils/utils";
export type { LogLevel } from "./utils/logger";
export * from "./utils/enums";

export { RemoteNode } from "./remote-node";
export type { RemoteNodeEvents } from "./remote-node";

export { MeshClientError } from "./p2p/mesh-client-error";

// For backwards compatibility
export { MeshClient as Peer };

export default MeshClient;
