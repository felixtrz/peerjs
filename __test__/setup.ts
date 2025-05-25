import "./faker";
import { util } from "../src/utils/utils";

// Mock console methods to silence PeerJS logs during tests
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;

console.error = (...args: any[]) => {
	// Filter out PeerJS error messages
	if (args.some(arg => typeof arg === 'string' && arg.includes('PeerJS:'))) {
		return;
	}
	originalConsoleError(...args);
};

console.warn = (...args: any[]) => {
	// Filter out PeerJS warning messages
	if (args.some(arg => typeof arg === 'string' && arg.includes('PeerJS:'))) {
		return;
	}
	originalConsoleWarn(...args);
};

console.log = (...args: any[]) => {
	// Filter out PeerJS log messages
	if (args.some(arg => typeof arg === 'string' && arg.includes('PeerJS:'))) {
		return;
	}
	originalConsoleLog(...args);
};

//enable support for WebRTC
util.supports.data = true;
util.randomToken = () => "testToken";
