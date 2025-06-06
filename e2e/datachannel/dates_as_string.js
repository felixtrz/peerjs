import { dates } from "../data.js";
import { expect } from "https://esm.sh/v126/chai@4.3.7/X-dHMvZXhwZWN0/es2021/chai.bundle.mjs";

/** @param {unknown[]} received */
export const check = (received) => {
	console.log(dates.map((date) => date.toString()));
	expect(received).to.deep.equal(dates.map((date) => date.toString()));
};
/**
 * @param {import("../peerjs").Node} node
 */
export const send = (node) => {
	for (const date of dates) {
		node.send(date);
	}
};
