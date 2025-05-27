# Ping Discovery Feature

## Overview

The Ping Discovery feature enhances the existing ping mechanism in PeerJS to enable mesh network discovery. When nodes measure their ping to connected peers, they also share information about other peers they're connected to, allowing the mesh network to automatically discover and connect to new nodes.

## How It Works

### 1. Enhanced Ping Mechanism

The existing ping monitoring in `RemoteNode` has been extended to include peer discovery:

- **Maintains existing functionality**: RTT measurement using WebRTC stats every 1 second
- **Adds peer discovery**: Along with ping data, nodes share their list of connected peers
- **Uses default channels**: Discovery messages are sent via the default channel configuration to measure ping for the most common traffic type

### 2. Discovery Message Format

```typescript
{
  __peerJSInternal: true,
  type: "ping-discovery",
  ping: number | null,        // RTT in milliseconds, null if unavailable
  peers: string[],            // Array of connected peer IDs (filtered)
  timestamp: number,          // Message timestamp
  senderId: string | null     // ID of the sending peer
}
```

### 3. Automatic Peer Connection

When a node receives ping discovery messages:

- It processes the peer list and identifies new peers
- Automatically attempts to connect to discovered peers via `MeshClient._connectToMeshPeers()`
- Emits `ping-discovery` events for application-level handling

## Key Features

### Intelligent Filtering

- **Target filtering**: Nodes don't send their own peer ID to the target peer
- **Self-filtering**: Nodes don't attempt to connect to themselves
- **Existing connection awareness**: Works with existing mesh handshake mechanisms

### Backward Compatibility

- **No breaking changes**: Existing ping functionality is preserved
- **Optional discovery**: Ping discovery enhances but doesn't replace existing mesh features
- **Event-based**: Applications can listen to ping-discovery events if needed

### Transport Channel Selection

Ping discovery uses **default channels** for message transport to:

- **Measure real-world performance**: Uses the same channel type as most application traffic
- **Reflect actual user experience**: Ping measurements represent the typical connection quality
- **Avoid channel forcing**: Doesn't override application-level channel configuration choices
- **Maintain flexibility**: Works with whatever channel configuration the application has chosen

This approach provides more representative ping measurements by using the same transport mechanism as regular application data, though it may occasionally experience message loss in unreliable channels (compensated by increased ping frequency).

### Performance Optimized

- **Default channel transport**: Uses default channels to measure representative performance for most common traffic
- **Efficient timing**: Piggybacks on existing 1-second ping intervals
- **Minimal overhead**: Only sends peer lists, not full mesh state

## Usage

### Listening to Discovery Events

```typescript
remoteNode.on("ping-discovery", (data) => {
	console.log(`Discovered ${data.peers.length} peers from ${data.remotePeer}`);
	console.log(`Ping to ${data.remotePeer}: ${data.ping}ms`);
	console.log("Discovered peers:", data.peers);
});
```

### Integration with Existing Mesh

The ping discovery works seamlessly with existing mesh networking:

```typescript
// Existing mesh functionality still works
const meshClient = new MeshClient();
const node = meshClient.connect("peer-id");

// Ping discovery happens automatically
node.on("ping", (latency) => {
	console.log(`Ping: ${latency}ms`);
});

// Discovery events provide additional mesh insight
node.on("ping-discovery", (data) => {
	console.log(`Mesh discovery: ${data.peers.length} new peers found`);
});
```

## Implementation Details

### Code Changes

1. **RemoteNode.\_measurePing()**: Enhanced to call `_sendPingWithPeerDiscovery()`
2. **RemoteNode.\_sendPingWithPeerDiscovery()**: New method that sends discovery messages
3. **RemoteNode.\_handlePingDiscovery()**: New method that processes incoming discovery messages
4. **RemoteNode.\_isInternalMeshMessage()**: Updated to recognize ping-discovery messages
5. **RemoteNodeEvents interface**: Added ping-discovery event type

### Error Handling

- **Graceful degradation**: Discovery failures don't affect ping measurement
- **Malformed message handling**: Invalid discovery messages are processed safely
- **Network resilience**: Uses try-catch blocks and logging for debugging

### Testing

Comprehensive test suite covers:

- ✅ Ping discovery message sending during normal ping operation
- ✅ Handling of null ping values when RTT is unavailable
- ✅ Incoming ping discovery message processing
- ✅ Peer list filtering and connection attempts
- ✅ Error handling for malformed messages
- ✅ Edge cases like empty peer lists and null providers

## Mesh Discovery Scenario

Consider a mesh network: `A ↔ B ↔ C` where A doesn't know about C.

1. **B sends ping to A**: Includes peer list `["C"]` (filtered out A)
2. **A receives discovery**: Learns about peer C through ping discovery
3. **A connects to C**: Uses existing `_connectToMeshPeers()` method
4. **Result**: Mesh becomes `A ↔ B ↔ C` with A also connected to C

This enables automatic mesh densification and improved network resilience.

## Performance Impact

- **Minimal CPU overhead**: Reuses existing ping timers and WebRTC stats
- **Network efficiency**: Small messages sent every 1 second per connection
- **Memory efficient**: No persistent storage of discovery state
- **Non-blocking**: Uses default channels to provide representative performance measurements

## Future Enhancements

Potential improvements could include:

- **Discovery rate limiting**: Configurable ping/discovery intervals
- **Selective discovery**: Option to enable/disable discovery per connection
- **Discovery metrics**: Track discovery success rates and mesh growth
- **Advanced filtering**: More sophisticated peer selection algorithms
