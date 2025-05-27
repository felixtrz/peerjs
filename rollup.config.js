import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";

export default {
	input: "lib/index.js",
	plugins: [resolve(), commonjs()],
	output: [
		// UMD build
		{
			file: "build/linkt.js",
			format: "umd",
			name: "Linkt",
		},
		// Minified UMD build
		{
			file: "build/linkt.min.js",
			format: "umd",
			name: "Linkt",
			plugins: [terser()],
		},
		// ES module build
		{
			file: "build/linkt.module.js",
			format: "es",
		},
		// Minified ES module build
		{
			file: "build/linkt.module.min.js",
			format: "es",
			plugins: [terser()],
		},
	],
};
