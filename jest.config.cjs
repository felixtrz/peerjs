/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
	testEnvironment: "jsdom",
	transform: {
		"^.+\\.(t|j)sx?$": ["@swc/jest"],
	},
	modulePathIgnorePatterns: ["e2e"],
	setupFilesAfterEnv: ["<rootDir>/__test__/setup.ts"],
};
