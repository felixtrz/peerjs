import "./setup";
import { Peer } from "../lib/peer";
import { Server } from "mock-socket";
import { PeerErrorType, ServerMessageType } from "../lib/enums";
import { expect, beforeAll, afterAll, describe, it } from "@jest/globals";

const createMockServer = (): Server => {
	const fakeURL = "ws://localhost:8080/peerjs?key=peerjs&id=1&token=testToken";
	const mockServer = new Server(fakeURL);

	mockServer.on("connection", (socket) => {
		//@ts-ignore
		socket.on("message", (data) => {
			socket.send("test message from mock server");
		});

		socket.send(JSON.stringify({ type: ServerMessageType.Open }));
	});

	return mockServer;
};
describe("Peer", () => {
	describe("after construct without parameters", () => {
		it("shouldn't contains any connection", () => {
			const peer = new Peer();

			expect(peer.open).toBe(false);
			expect(peer.connections).toEqual({});
			expect(peer.id).toBeNull();
			expect(peer.disconnected).toBe(false);
			expect(peer.destroyed).toBe(false);

			peer.destroy();
		});
	});

	describe("after construct with parameters", () => {
		it("should contains id and key", () => {
			const peer = new Peer("1", { key: "anotherKey" });

			expect(peer.id).toBe("1");
			expect(peer.options.key).toBe("anotherKey");

			peer.destroy();
		});
	});

	describe("reconnect", () => {
		let mockServer;

		beforeAll(() => {
			mockServer = createMockServer();
		});

		it("connect to server => disconnect => reconnect => destroy", (done) => {
			const peer1 = new Peer("1", { port: 8080, host: "localhost" });

			peer1.once("open", () => {
				expect(peer1.open).toBe(true);

				peer1.once("disconnected", () => {
					expect(peer1.disconnected).toBe(true);
					expect(peer1.destroyed).toBe(false);
					expect(peer1.open).toBe(false);

					peer1.once("open", (id) => {
						expect(id).toBe("1");
						expect(peer1.disconnected).toBe(false);
						expect(peer1.destroyed).toBe(false);
						expect(peer1.open).toBe(true);

						peer1.once("disconnected", () => {
							expect(peer1.disconnected).toBe(true);
							expect(peer1.destroyed).toBe(false);
							expect(peer1.open).toBe(false);

							peer1.once("close", () => {
								expect(peer1.disconnected).toBe(true);
								expect(peer1.destroyed).toBe(true);
								expect(peer1.open).toBe(false);

								done();
							});
						});

						peer1.destroy();
					});

					peer1.reconnect();
				});

				peer1.disconnect();
			});
		});

		it("disconnect => reconnect => destroy", (done) => {
			mockServer.stop();

			const peer1 = new Peer("1", { port: 8080, host: "localhost" });

			peer1.once("disconnected", (id) => {
				expect(id).toBe("1");
				expect(peer1.disconnected).toBe(true);
				expect(peer1.destroyed).toBe(false);
				expect(peer1.open).toBe(false);

				peer1.once("open", (id) => {
					expect(id).toBe("1");
					expect(peer1.disconnected).toBe(false);
					expect(peer1.destroyed).toBe(false);
					expect(peer1.open).toBe(true);

					peer1.once("disconnected", () => {
						expect(peer1.disconnected).toBe(true);
						expect(peer1.destroyed).toBe(false);
						expect(peer1.open).toBe(false);

						peer1.once("close", () => {
							expect(peer1.disconnected).toBe(true);
							expect(peer1.destroyed).toBe(true);
							expect(peer1.open).toBe(false);

							done();
						});
					});

					peer1.destroy();
				});

				mockServer = createMockServer();

				peer1.reconnect();
			});
		});

		it("destroy peer if no id and no connection", (done) => {
			mockServer.stop();

			const peer1 = new Peer({ port: 8080, host: "localhost" });

			peer1.once("error", (error) => {
				expect(error.type).toBe(PeerErrorType.ServerError);

				peer1.once("close", () => {
					expect(peer1.disconnected).toBe(true);
					expect(peer1.destroyed).toBe(true);
					expect(peer1.open).toBe(false);

					done();
				});

				mockServer = createMockServer();
			});
		});

		afterAll(() => {
			mockServer.stop();
		});
	});
});
