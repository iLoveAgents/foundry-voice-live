# Claude Code Context

> **Note**: This file exists for Claude Code compatibility. The canonical documentation for AI agents is in [AGENTS.md](./AGENTS.md).

## Quick Reference

**Project**: foundry-voice-live - SDKs for Microsoft Foundry Voice Live API

**Packages**:
- `@iloveagents/foundry-voice-live-react` - React hooks/components (packages/react)
- `@iloveagents/foundry-voice-live-proxy-node` - WebSocket proxy server (packages/proxy-node)

**Commands** (use `just`):
```bash
just install    # Install dependencies
just build      # Build all packages
just test       # Run tests
just dev        # Start dev servers
just lint       # Lint code
```

**Key Files**:
- [packages/react/index.ts](packages/react/index.ts) - React SDK entry point
- [packages/proxy-node/src/index.ts](packages/proxy-node/src/index.ts) - Proxy server entry
- [justfile](justfile) - All build/dev commands

## Code Standards Summary

- TypeScript strict mode
- Functional React components with hooks
- ESM + CommonJS dual exports
- Vitest for testing
- pnpm workspaces for monorepo

## Full Documentation

See **[AGENTS.md](./AGENTS.md)** for complete guidance including:
- Repository structure
- Package relationships
- Code style guidelines
- Testing patterns
- Publishing workflow
- Troubleshooting

## Important Reminders

1. **Never expose API keys** in client code for production
2. Use `workspace:*` for internal package dependencies
3. Run `just build` before `just test` for demos
4. The proxy package is optional - React SDK can connect directly

---

*This file is read by Claude Code. For human documentation, see README.md.*
