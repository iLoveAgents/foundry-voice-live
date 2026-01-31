# React SDK

Package: `@iloveagents/foundry-voice-live-react`

## Exports

| Export | Type | Description |
| ------ | ---- | ----------- |
| `useVoiceLive` | Hook | Voice Live API integration |
| `useAudioCapture` | Hook | Microphone audio capture |
| `VoiceLiveAvatar` | Component | Avatar rendering with chroma key |

Configuration helpers available for voice, avatar, and turn detection.

## Commands

```bash
just build-react      # Build package
just test-react       # Run tests
just watch-react      # Watch mode
```

## Structure

```text
hooks/          # useVoiceLive, useAudioCapture
components/     # VoiceLiveAvatar
utils/          # chromaKey, sessionBuilder, configHelpers
types/          # TypeScript definitions
presets/        # Configuration presets
index.ts        # Public API
```

## Design

- Zero runtime dependencies (peer deps: React only)
- Tree-shakeable ESM and CommonJS dual exports
- WebGL chroma key processing for avatar transparency
- Event-driven architecture matching Voice Live WebSocket protocol

## Adding Features

1. Add types in `types/`
2. Implement in `hooks/`, `components/`, or `utils/`
3. Export from `index.ts`
4. Add tests
5. Update README

## Example

```typescript
import { useVoiceLive } from '@iloveagents/foundry-voice-live-react';

function App() {
  const { status, connect, disconnect } = useVoiceLive({
    onMessage: (event) => console.log(event),
    onError: (error) => console.error(error),
  });

  return <button onClick={connect}>{status}</button>;
}
```
