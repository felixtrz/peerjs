import { dates } from "../data.js";
import { expect } from "https://esm.sh/v126/chai@4.3.7/X-dHMvZXhwZWN0/es2021/chai.bundle.mjs";

/** @param {unknown[]} received */
export const check = (received) => {
	expect(received).to.deep.equal(dates);
};
/**
 * @param {import("../peerjs").Node} node
 */
export const send = (node) => {
	for (const date of dates) {
		node.send(date);
	}
};
