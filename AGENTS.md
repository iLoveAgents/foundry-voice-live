# AGENTS.md

This file provides guidance for AI coding agents working on the **foundry-voice-live** monorepo.

## Project Overview

**foundry-voice-live** is a monorepo by [iLoveAgents.ai](https://iLoveAgents.ai) containing SDKs and tools for **Microsoft Foundry Voice Live API** - enabling real-time voice interactions with AI agents.

> **Note**: This project was previously named "azure-voice-live" and has been renamed to align with Microsoft's rebranding of the service from "Azure Voice Live" to "Voice Live" within Microsoft Foundry.

### What is Voice Live?

Microsoft Foundry Voice Live API is a unified solution for low-latency, high-quality speech-to-speech interactions:
- Integrates speech recognition, generative AI (GPT-4o, GPT-4.1, Phi, etc.), and text-to-speech
- Provides noise suppression, echo cancellation, and advanced turn detection
- Supports 140+ locales for speech-to-text and 600+ voices across 150+ locales
- Enables avatar integration synchronized with audio output
- Offers function calling for external actions and VoiceRAG patterns

### Technology Stack

- **Monorepo**: pnpm workspaces + just (command runner)
- **Languages**: TypeScript (React, Node.js)
- **Build**: tsup (React library), tsc (proxy server), Vite (demos)
- **Testing**: Vitest
- **CI/CD**: GitHub Actions

## Repository Structure

```
foundry-voice-live/
├── packages/
│   ├── react/                    # @iloveagents/foundry-voice-live-react
│   │   ├── components/           # React components (VoiceLiveAvatar)
│   │   ├── hooks/                # React hooks (useVoiceLive, useAudioCapture)
│   │   ├── utils/                # Utilities (chromaKey, sessionBuilder, configHelpers)
│   │   ├── types/                # TypeScript type definitions
│   │   ├── presets/              # Configuration presets
│   │   └── index.ts              # Main export
│   │
│   └── proxy-node/               # @iloveagents/foundry-voice-live-proxy-node
│       ├── src/
│       │   ├── index.ts          # Express + WebSocket server
│       │   └── __tests__/        # Unit tests
│       ├── Dockerfile
│       └── docker-compose.yml
│
├── demos/
│   ├── playground/               # Interactive playground for testing
│   │   └── src/pages/            # Example implementations
│   │
│   └── avatar/                   # Full-featured avatar demo (Luna assistant)
│       ├── src/components/
│       ├── src/tools/            # AI function calling system
│       └── src/config/
│
├── docs/                         # Documentation
├── .github/workflows/            # CI/CD pipelines
├── justfile                      # Task runner recipes
├── pnpm-workspace.yaml           # Workspace configuration
└── package.json                  # Root package.json
```

## Package Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                        Consumer Apps                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│     @iloveagents/foundry-voice-live-react (React SDK)           │
│     - useVoiceLive hook for WebSocket management                │
│     - VoiceLiveAvatar component with chroma key                 │
│     - Configuration helpers and presets                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│   @iloveagents/foundry-voice-live-proxy-node (optional)         │
│   - Secure WebSocket proxy for authentication                   │
│   - Moves MSAL token from URL to Authorization header           │
│   - Hides API key on server side                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│            Microsoft Foundry Voice Live API                      │
│            wss://<resource>.cognitiveservices.azure.com          │
└─────────────────────────────────────────────────────────────────┘
```

## Development Environment

### Prerequisites

- **Node.js** >= 18.0.0
- **pnpm** >= 9.0.0 (`npm install -g pnpm`)
- **just** command runner (`brew install just` on macOS)
- Azure AI Foundry resource with Voice Live API access

### Initial Setup

```bash
# Clone repository
git clone https://github.com/iloveagents/foundry-voice-live.git
cd foundry-voice-live

# Install all dependencies
just install

# Build all packages
just build

# Run tests
just test
```

### Available Commands

Run `just` to see all commands:

```bash
# Installation
just install          # Install all dependencies
just clean-install    # Clean + install

# Building
just build            # Build all packages
just build-react      # Build React package only
just build-proxy      # Build proxy package only

# Development
just dev              # Run all dev servers in parallel
just dev-playground   # Run playground only (port 3001)
just dev-avatar       # Run avatar demo only
just dev-proxy        # Run proxy server only (port 8080)
just watch-react      # Watch mode for React package

# Testing
just test             # Run all tests
just test-react       # Test React package
just test-proxy       # Test proxy package
just test-coverage    # Tests with coverage

# Code Quality
just lint             # Lint all packages
just lint-fix         # Fix linting issues
just format           # Format with Prettier
just typecheck        # TypeScript type checking

# Publishing
just publish-dry      # Preview npm publish
just publish-all      # Publish all packages

# Utilities
just deps             # Show dependency graph
just clean            # Clean build artifacts
```

## Code Style Guidelines

### TypeScript Standards

- **Strict mode enabled** in all packages
- **Target**: ES2020+ with ESNext modules
- Use explicit types for function parameters and return values
- Prefer interfaces over type aliases for object shapes
- Export types alongside implementations

### React Patterns (packages/react)

```typescript
// ✅ Good: Functional components with hooks
export function useVoiceLive(options: VoiceLiveOptions): VoiceLiveResult {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');

  // Effects after state
  useEffect(() => {
    // Cleanup on unmount
    return () => wsRef.current?.close();
  }, []);

  return { status, connect, disconnect };
}

// ✅ Good: SDK instances in refs, not state
const speechSdkRef = useRef<SpeechSDK | null>(null);

// ❌ Bad: SDK in state causes unnecessary re-renders
const [speechSdk, setSpeechSdk] = useState<SpeechSDK | null>(null);
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `VoiceLiveAvatar` |
| Hooks | camelCase with `use` prefix | `useVoiceLive` |
| Functions | camelCase | `createSession` |
| Constants (exported) | UPPER_SNAKE_CASE | `DEFAULT_CONFIG` |
| Types/Interfaces | PascalCase | `VoiceLiveOptions` |
| Files | camelCase for utils, PascalCase for components | `configHelpers.ts`, `VoiceLiveAvatar.tsx` |

### Import Organization

```typescript
// 1. External packages
import { useState, useEffect, useRef } from 'react';

// 2. Internal packages (workspace)
import { useVoiceLive } from '@iloveagents/foundry-voice-live-react';

// 3. Relative imports
import { createConfig } from '../utils/configHelpers';
import type { VoiceLiveOptions } from '../types';
```

### Error Handling

```typescript
// ✅ Good: Structured error handling with logging
try {
  await connection.connect();
} catch (error) {
  console.error('[VoiceLive] Connection failed:', {
    error: error instanceof Error ? error.message : error,
    timestamp: new Date().toISOString(),
  });
  setStatus('error');
  onError?.(error as Error);
}

// ❌ Bad: Silent failures
try {
  await connection.connect();
} catch (e) {
  // Do nothing
}
```

## Package-Specific Guidelines

### React Package (`packages/react`)

**Core Exports:**
- `useVoiceLive` - Main hook for Voice Live API integration
- `useAudioCapture` - Microphone audio capture
- `VoiceLiveAvatar` - React component for avatar rendering
- Configuration helpers for voice, avatar, turn detection

**Key Design Decisions:**
- Zero runtime dependencies (peer deps only: React)
- Tree-shakeable ESM + CommonJS dual exports
- WebGL chroma key processing for avatars
- Event-driven architecture matching Voice Live WebSocket protocol

**Adding New Features:**
1. Add types in `types/`
2. Implement in appropriate directory (`hooks/`, `components/`, `utils/`)
3. Export from `index.ts`
4. Add tests
5. Update README

### Proxy Package (`packages/proxy-node`)

**Purpose:**
- Secure WebSocket proxy between browser and Voice Live API
- Handles authentication (MSAL token or API key)
- Provides rate limiting and security headers

**Key Design Decisions:**
- ES Modules (`"type": "module"`)
- Express + express-ws for WebSocket support
- Docker-ready with health checks
- Environment-based configuration

**Environment Variables:**
```bash
AZURE_REGION=westus2
AZURE_RESOURCE_NAME=your-resource
AZURE_API_KEY=your-key  # Optional if using MSAL
PORT=8080
```

## Testing Guidelines

### Test Structure

```typescript
// packages/react/utils/configHelpers.test.ts
import { describe, it, expect } from 'vitest';
import { createVoiceConfig } from './configHelpers';

describe('createVoiceConfig', () => {
  it('should create valid voice configuration', () => {
    const config = createVoiceConfig({ voice: 'en-US-JennyNeural' });

    expect(config).toMatchObject({
      voice: 'en-US-JennyNeural',
      // ... expected properties
    });
  });

  it('should use defaults for missing options', () => {
    const config = createVoiceConfig({});

    expect(config.voice).toBeDefined();
  });
});
```

### Running Tests

```bash
# All tests
just test

# Specific package
just test-react
just test-proxy

# Watch mode (during development)
pnpm --filter @iloveagents/foundry-voice-live-react run test:watch

# With coverage
just test-coverage
```

### What to Test

- **Utilities**: Pure functions, configuration builders
- **Hooks**: State transitions, cleanup behavior
- **Components**: Rendering, user interactions
- **API**: Request/response handling, error cases

### What NOT to Test

- Azure SDK internals (mock these)
- WebSocket protocol details (integration test scope)
- Third-party library behavior

## Publishing Workflow

### Version Strategy

- **React package**: Semantic versioning, currently v0.x (pre-1.0)
- **Proxy package**: Semantic versioning, v1.x stable

### Pre-publish Checklist

1. Run full test suite: `just test`
2. Run linting: `just lint`
3. Build all packages: `just build`
4. Preview publish: `just publish-dry`
5. Update CHANGELOG.md
6. Commit changes
7. Publish: `just publish-all`

### npm Package Contents

Each package's `files` field in package.json controls what's published:

```json
// React package
"files": ["dist", "README.md"]

// Proxy package
"files": ["dist/", "LICENSE", "README.md", ".env.example", "Dockerfile", "docker-compose.yml"]
```

## Common Tasks

### Adding a New Hook

```bash
# 1. Create hook file
touch packages/react/hooks/useNewHook.ts

# 2. Add types if needed
touch packages/react/types/newHook.ts

# 3. Export from index
echo "export * from './hooks/useNewHook';" >> packages/react/index.ts

# 4. Add tests
touch packages/react/hooks/useNewHook.test.ts

# 5. Build and test
just build-react && just test-react
```

### Adding a New Demo Page

```bash
# 1. Create page component
touch demos/playground/src/pages/NewExample.tsx

# 2. Add route in App.tsx
# 3. Add link in HomePage.tsx
# 4. Test: just dev-playground
```

### Debugging WebSocket Issues

```typescript
// Enable verbose logging in development
const { status, connect } = useVoiceLive({
  debug: true,  // Logs all WebSocket events
  onMessage: (event) => console.log('[WS]', event),
  onError: (error) => console.error('[WS Error]', error),
});
```

### Testing with Different Models

Voice Live supports multiple models. Update session config:

```typescript
const session = useVoiceLive({
  model: 'gpt-4o',        // Default
  // model: 'gpt-4o-mini', // Faster, cheaper
  // model: 'gpt-4.1',     // Latest
  // model: 'phi4-mini',   // Cost-optimized
});
```

## Security Considerations

### Critical Warnings

⚠️ **Never expose Azure API keys in client-side code in production**

The React package connects directly to Voice Live API. For production:
1. Use the proxy package to hide credentials
2. Implement proper authentication (Azure AD, MSAL)
3. Enable rate limiting
4. Use managed identities where possible

### Secrets Management

- ✅ `.env` files are gitignored
- ✅ Use environment variables for all secrets
- ✅ Proxy package supports both API key and MSAL auth
- ❌ Never commit API keys or tokens
- ❌ Never log sensitive authentication data

## Troubleshooting

### Common Issues

**"WebSocket connection failed"**
- Check Azure resource region matches endpoint
- Verify API key or MSAL token is valid
- Ensure Voice Live API is enabled on resource

**"Audio not captured"**
- Check microphone permissions in browser
- Ensure HTTPS (required for getUserMedia)
- Test with: `navigator.mediaDevices.getUserMedia({ audio: true })`

**"Avatar not rendering"**
- Check WebGL support: `!!document.createElement('canvas').getContext('webgl')`
- Verify avatar style/character exists in your region
- Check browser console for shader errors

### Getting Help

- GitHub Issues: https://github.com/iloveagents/foundry-voice-live/issues
- Microsoft Docs: https://learn.microsoft.com/azure/ai-services/speech-service/voice-live
- iLoveAgents: https://iloveagents.ai

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Make changes following code guidelines above
4. Run tests: `just test`
5. Run linting: `just lint`
6. Commit: `git commit -m 'Add amazing feature'`
7. Push: `git push origin feature/amazing-feature`
8. Open Pull Request

## License

MIT - see LICENSE file
