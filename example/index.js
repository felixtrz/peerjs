import { MeshClient } from "peerjs";

const mesh = new MeshClient();
window.mesh = mesh;

// Keep track of connected nodes
const connectedNodes = new Map();

// Helper function to create message elements
const createNewMessage = (sender, message) => {
	const newMessage = document.createElement("div");
	newMessage.classList.add("message-container");
	const senderElement = document.createElement("div");
	senderElement.classList.add("sender");
	senderElement.innerHTML = sender + ": ";
	const messageElement = document.createElement("p");
	messageElement.classList.add("message");
	messageElement.innerHTML = message;
	newMessage.appendChild(senderElement);
	newMessage.appendChild(messageElement);
	document.getElementById("messages").appendChild(newMessage);
	return newMessage;
};

// Display peer ID when available
mesh.on("open", (id) => {
	document.getElementById("my-id").innerHTML = id;
	createNewMessage("Me", "Connected to server with ID: " + id);
});

// Copy ID to clipboard on click
document.getElementById("my-id").addEventListener("click", () => {
	if (mesh.id) {
		navigator.clipboard.writeText(mesh.id);
	}
});

// Handle incoming connections
mesh.on("connection", (node) => {
	console.log("New connection from:", node.peer);
	connectedNodes.set(node.peer, node);
	createNewMessage(node.peer, "joined");

	// Listen for data from this node
	node.on("data", (data) => {
		console.log("Received data:", data);
		createNewMessage(node.peer, data);
	});

	// Handle node closing
	node.on("close", () => {
		connectedNodes.delete(node.peer);
		createNewMessage(node.peer, "left");
	});

	// Handle node errors
	node.on("error", (error) => {
		console.error("Node error:", error);
	});
});

// Handle mesh errors
mesh.on("error", (error) => {
	console.error("Mesh error:", error);
	createNewMessage("System", "Error: " + error.message);
});

// Handle disconnection from server
mesh.on("disconnected", () => {
	createNewMessage("System", "Disconnected from server");
});

// Connect to a peer
document.getElementById("connect").addEventListener("click", () => {
	const peerId = document.getElementById("peer-id").value;
	if (peerId) {
		console.log("Connecting to:", peerId);
		const node = mesh.connect(peerId);
		connectedNodes.set(node.peer, node);

		// Set up event handlers for outgoing connection
		node.on("open", () => {
			createNewMessage(node.peer, "connected");
		});

		node.on("data", (data) => {
			console.log("Received data:", data);
			createNewMessage(node.peer, data);
		});

		node.on("close", () => {
			connectedNodes.delete(node.peer);
			createNewMessage(node.peer, "disconnected");
		});

		node.on("error", (error) => {
			console.error("Node error:", error);
		});
	}
});

// Send message to all connected peers
document.getElementById("send").addEventListener("click", () => {
	const message = document.getElementById("message").value;
	if (message) {
		// Send to all connected nodes
		for (const [peerId, node] of connectedNodes) {
			if (node.open) {
				node.send(message);
			}
		}
		createNewMessage("Me", message);
		document.getElementById("message").value = "";
	}
});

// Disconnect from server
document.getElementById("disconnect").addEventListener("click", () => {
	mesh.disconnect();
	createNewMessage("Me", "Disconnected");
});
