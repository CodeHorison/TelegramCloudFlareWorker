# Telegram CloudFlare Worker
Telegram Cloudflare Worker based on TCP socket [docs](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets)
Forked from [Flowseal/tg-ws-proxy](https://github.com/Flowseal/tg-ws-proxy/blob/main/docs/CfWorker.md)

## Improvements Compared to the Original Worker

### Security & Validation

* Added `dst` validation before opening TCP connections
* Added hostname normalization using `trim()` and `toLowerCase()`
* Blocked malformed or potentially unsafe values:

  * URLs with protocols (`://`)
  * paths and slashes
  * query/hash characters
  * whitespace and control characters
* Added strict hostname validation
* Added strict IPv4 validation

### Stream & Socket Stability

* Added sequential TCP write queue to prevent concurrent `writer.write()` race conditions
* Added centralized `cleanup()` logic for deterministic teardown
* Added protection against double-close and repeated cleanup calls
* Added proper `releaseLock()` handling for both reader and writer
* Added explicit WebSocket `error` handling
* Added additional socket state checks before `send()` and `close()`

### Cloudflare Workers Optimization

* Reused a global `TextEncoder` instance to reduce allocations
* Added fast-path handling for `Uint8Array`
* Added support for generic typed arrays using `ArrayBuffer.isView()`
* Reduced unnecessary async listener overhead
* Reduced promise churn and dangling operations
* Improved behavior under Cloudflare Workers Free plan runtime limits

### Reliability Improvements

* Wrapped `connect()` in `try/catch`
* Improved TCP read loop shutdown behavior
* Removed duplicated teardown logic scattered across handlers
* Removed dangling event listeners during cleanup

### Protocol Compatibility

The transport protocol behavior itself was not changed:

* WebSocket <-> TCP bridge logic remains identical
* Raw TCP mode is preserved
* No automatic TLS was added
* Port `443` behavior remains unchanged
* Existing clients remain compatible
