import { int32_arrays } from "../data.js";
import { expect } from "https://esm.sh/v126/chai@4.3.7/X-dHMvZXhwZWN0/es2021/chai.bundle.mjs";

/** @param {unknown[]} received */
export const check = (received) => {
	for (const [i, typed_array] of int32_arrays.entries()) {
		expect(received[i]).to.be.an.instanceof(Uint8Array);
		expect(received[i]).to.deep.equal(new Uint8Array(typed_array.buffer));
	}
};
/**
 * @param {import("../peerjs").Node} node
 */
export const send = (node) => {
	for (const typed_array of int32_arrays) {
		node.send(typed_array);
	}
};
