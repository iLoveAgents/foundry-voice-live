# Unit Tests

Professional, focused unit tests for Microsoft Foundry Voice Live Proxy core functionality.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Test Coverage

The tests import the production connection builder and security helpers. They cover:

- GA defaults, explicit API overrides, and safely encoded query parameters
- WebRTC calls routing, realtime subprotocol, transport validation, and unchanged WebSocket defaults
- Early SDP buffering, persistent control/tool event forwarding, bounded buffering, and idempotent connection cleanup
- API-key headers, caller-token precedence, and server-side Entra authentication
- Foundry agent routing, version pinning, conversation resume, and resource overrides
- Classic agent invocation tokens and isolation from default-agent configuration
- BYOM profiles and preview feature forwarding
- Invalid/repeated parameters and credential failures
- Secret redaction and exact origin matching

These are offline unit tests. They exercise relay behavior with controlled sockets but do not connect to an Azure resource or transmit live WebRTC audio.

## Test Framework

- **Vitest** - Fast, TypeScript-native testing framework
- **Coverage** - V8 coverage provider for accurate reporting

## Writing Tests

Tests follow professional best practices:

- Focused and specific test cases
- Clear test names describing behavior
- Minimal mocking (unit-level testing)
- Fast execution (no real WebSocket connections)
- Type-safe with TypeScript

## CI/CD Integration

Add to your CI pipeline:

```yaml
- run: npm test
- run: npm run test:coverage
```
