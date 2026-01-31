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

The test suite covers:

- **URL Building** - Standard and Agent mode URL construction with different auth methods
- **Configuration Validation** - Environment variable parsing and validation
- **Message Filtering** - High-frequency message type identification
- **CORS Validation** - Origin validation and security checks
- **Connection Tracking** - Connection lifecycle and limits
- **Health Checks** - Server status and metrics
- **API Endpoints** - Server metadata and documentation

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
