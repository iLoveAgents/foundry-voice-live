# Foundry Voice Live

React SDK and tools for Microsoft Foundry Voice Live API.

## Commands

```bash
just install          # Install dependencies
just build            # Build all packages
just test             # Run tests
just dev              # Start dev servers
just lint             # Lint code
just typecheck        # TypeScript checks
```

## Packages

| Package | Path | npm |
| ------- | ---- | --- |
| React SDK | `packages/react/` | `@iloveagents/foundry-voice-live-react` |
| Proxy | `packages/proxy-node/` | `@iloveagents/foundry-voice-live-proxy-node` |

Each package has its own AGENTS.md with specific guidance.

## Examples

Interactive examples demonstrating Voice Live API features: `examples/`

Run with `just dev-examples` (port 3001).

## Code Style

TypeScript strict mode with ES2020+ target.

### Imports

```typescript
// 1. External packages
import { useState, useEffect, useRef } from 'react';

// 2. Workspace packages
import { useVoiceLive } from '@iloveagents/foundry-voice-live-react';

// 3. Relative imports
import { createConfig } from '../utils/configHelpers';
import type { VoiceLiveOptions } from '../types';
```

### Patterns

- Functional React components with hooks
- SDK instances in useRef, not useState
- Explicit types for function parameters and returns
- Prefer interfaces over type aliases for objects

### Naming

| Type | Convention | Example |
| ---- | ---------- | ------- |
| Components | PascalCase | `VoiceLiveAvatar` |
| Hooks | use + camelCase | `useVoiceLive` |
| Utilities | camelCase | `createSession` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_CONFIG` |
| Types | PascalCase | `VoiceLiveOptions` |

### Error Handling

```typescript
try {
  await connection.connect();
} catch (error) {
  console.error('[VoiceLive] Connection failed:', {
    error: error instanceof Error ? error.message : error,
    timestamp: new Date().toISOString(),
  });
  onError?.(error as Error);
}
```

## Security

Never expose Azure API keys in client code. Use the proxy package for production deployments.

## Links

- [GitHub](https://github.com/iloveagents/foundry-voice-live)
- [Voice Live API](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
