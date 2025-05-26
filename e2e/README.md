# E2E Test Structure

The end-to-end tests are organized into the following categories:

## Directory Structure

```
e2e/
├── datachannel/           # WebRTC data channel tests
│   ├── multi-channel/     # Multi-channel functionality tests
│   │   ├── multi-channel.spec.js
│   │   ├── multi-channel-simple.spec.js
│   │   ├── multi-channel.page.js
│   │   └── multi-channel.html
│   └── serialization/     # Data serialization tests
│       ├── specs/         # Test specifications
│       │   ├── serialization_binary.spec.js
│       │   └── serialization_json.spec.js
│       ├── data-types/    # Test data for different types
│       │   ├── arrays.js
│       │   ├── arraybuffers.js
│       │   ├── dates.js
│       │   ├── numbers.js
│       │   ├── objects.js
│       │   ├── strings.js
│       │   └── ... (other type-specific tests)
│       ├── serialization.html
│       ├── serialization.js
│       ├── serialization.page.js
│       └── serializationTest.js
├── peer/                  # Peer connection tests
│   ├── peer.spec.js
│   ├── peer.page.js
│   ├── disconnected.html
│   ├── id-taken.html
│   └── server-unavailable.html
├── data.js               # Shared test data
├── commit_data.js        # Sample commit data for tests
├── alice.html            # Test page for Alice peer
├── bob.html              # Test page for Bob peer
└── run-e2e.js           # E2E test runner script
```

## Test Categories

### 1. Multi-Channel Tests
Tests for multiple data channel support between peers, including reliable and realtime channels.

### 2. Serialization Tests
Tests for data serialization capabilities:
- **Binary serialization**: Tests binary data transfer
- **JSON serialization**: Tests JSON data transfer
- **Data types**: Individual test files for different data types (arrays, strings, numbers, dates, typed arrays, etc.)

### 3. Peer Tests
Tests for peer connection scenarios including disconnection, ID conflicts, and server unavailability.

## Running Tests

```bash
npm run e2e
```

This will start a local HTTP server and run all E2E tests using WebdriverIO.