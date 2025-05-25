/**
 * @type {typeof import("../../src/index.js").Peer}
 */
const Peer = window.peerjs.Peer;

const params = new URLSearchParams(document.location.search);
const testfile = params.get("testfile");
const serialization = params.get("serialization");

(async () => {
	const serializers = {};

	const { check, send } = await import(`./${testfile}.js`);
	document.getElementsByTagName("title")[0].innerText =
		window.location.hash.substring(1);

	const checkBtn = document.getElementById("check-btn");
	const sendBtn = document.getElementById("send-btn");
	const receiverIdInput = document.getElementById("receiver-id");
	const connectBtn = document.getElementById("connect-btn");
	const messages = document.getElementById("messages");
	const result = document.getElementById("result");
	const errorMessage = document.getElementById("error-message");

	const peer = new Peer({
		debug: 3,
		serializers,
		key: params.get("key"),
	});
	const received = [];
	/**
	 * @type {import("../../src/index.js").Node}
	 */
	let node;
	peer
		.once("open", (id) => {
			messages.textContent = `Your Peer ID: ${id}`;
		})
		.once("error", (error) => {
			errorMessage.textContent = JSON.stringify(error);
		})
		.once("connection", (remoteNode) => {
			node = remoteNode;
			node.on("data", (data) => {
				console.log(data);
				received.push(data);
			});
			node.once("close", () => {
				messages.textContent = "Closed!";
			});
		});

	connectBtn.addEventListener("click", () => {
		const receiverId = receiverIdInput.value;
		if (receiverId) {
			node = peer.connect(receiverId, {
				reliable: true,
				serialization,
			});
			node.once("open", () => {
				messages.textContent = "Connected!";
			});
		}
	});

	checkBtn.addEventListener("click", async () => {
		try {
			console.log(received);
			check(received);
			result.textContent = "Success!";
		} catch (e) {
			result.textContent = "Failed!";
			errorMessage.textContent = JSON.stringify(e.message);
		} finally {
			messages.textContent = "Checked!";
		}
	});

	sendBtn.addEventListener("click", async () => {
		node.once("error", (err) => {
			errorMessage.innerText = err.toString();
		});
		await send(node);
		// Add a small delay before closing to ensure all messages are sent
		setTimeout(() => {
			node.close();
			messages.textContent = "Sent!";
		}, 500);
	});
	window["connect-btn"].disabled = false;
})();
