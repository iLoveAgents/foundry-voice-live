# AGENTS.md

This file provides guidance for AI coding agents working on the **azure-live-voice-avatar** project.

## Project Overview

**azure-live-voice-avatar** is a demo by [iLoveAgents.ai](https://iLoveAgents.ai) - a React TypeScript single-page application that demonstrates how to:

- Run an **Azure AI Foundry Voice Live** session (GPT-4o Realtime) directly from the browser
- Stream microphone audio with **Azure AI Speech Services** and render an **Azure Text-to-Speech Avatar**
- Display avatar video with GPU-accelerated WebGL chroma key for transparent backgrounds
- Present contextual content inside Microsoft Fluent UI drawers (text, markdown, mermaid diagrams)
- Execute AI assistant helper tools such as DOM queries and modal controls
- Implement real-time conversational AI with **Luna**, an AI agents expert assistant

**Technology Stack:**

- React 18 with TypeScript
- **Azure AI Foundry** Voice Live API (GPT-4o Realtime)
- **Azure AI Speech Services** SDK (Text-to-Speech Avatars)
- Microsoft Cognitive Services Speech SDK
- Microsoft Fluent UI React Components v9
- Create React App (react-scripts)
- WebGL for GPU-accelerated chroma keying

## Development Environment Setup

### Prerequisites

- Node.js 18+ and npm 8+
- **Azure AI Foundry** resource with Voice Live API access
- **Azure AI Services** resource with Speech Services (Text-to-Speech Avatar support)
- Modern browser with microphone + WebRTC support (Chrome, Edge recommended; Safari supported)

### Initial Setup

```bash
# Install dependencies
npm install

# Copy environment template and configure
cp .env.example .env
# Edit .env with your Azure credentials (NEVER commit this file)

# Start development server
npm start
```

The app will be available at [http://localhost:3000](http://localhost:3000)

### Environment Variables

Copy `.env.example` to `.env` and set the required secret:

**Required:**
- `REACT_APP_AZURE_SPEECH_KEY` - Azure AI Services key (used for Voice Live + Avatar) - **Secret**

**Optional (have production defaults in code):**
- `REACT_APP_AZURE_AI_FOUNDRY_RESOURCE` - Azure AI Foundry resource name without protocol (default: `aif-iloveagents-ttsavatar-dev`)
- `REACT_APP_AVATAR_CHARACTER` - Avatar character (default: `lisa`)
- `REACT_APP_AVATAR_STYLE` - Avatar style (default: `casual-standing`)

## Project Architecture

### Modular Structure

The codebase follows a clean, modular architecture with clear separation of concerns:

```
src/
├── config/          # Configuration (Azure, system prompt)
├── theme/           # Fluent UI theme definitions
├── styles/          # CSS-in-JS styles using Fluent UI tokens
├── tools/           # AI function calling architecture
│   ├── toolDefinitions.ts   # Tool schemas for AI
│   ├── toolHandlers.ts      # Tool implementations
│   ├── useToolExecution.ts  # Tool execution hook
│   └── README.md            # Complete tools guide
├── utils/           # Reusable utilities (chroma key, etc.)
└── components/      # React components
```

### Key Modules

- **`src/config/`** - All configuration centralized (Azure, prompts)
- **`src/tools/`** - AI function calling system (see [tools/README.md](src/tools/README.md))
- **`src/utils/chromaKey.ts`** - WebGL shader for green screen removal
- **`src/theme/`** - Fluent UI theme using design tokens
- **`src/styles/`** - Component styles using `makeStyles` and tokens

## Code Style Guidelines

### TypeScript Standards

- **Strict mode enabled** - All TypeScript strict checks are enforced
- **Target:** ES5 with ESNext module syntax
- **JSX:** Use `react-jsx` transform (no React imports needed in files)
- Use explicit types for function parameters and return values
- Prefer interfaces over type aliases for object shapes
- Export types alongside implementations for reusability

### React Patterns

- **Functional components only** - Use hooks, not class components
- **Hooks organization:**
  - Group related refs together at the top
  - State declarations follow refs
  - useMemo/useCallback for expensive operations
  - Effects come after state
  - Custom hooks (e.g., `useToolExecution`) for complex logic
  - Helper functions defined after hooks
- Use `useRef` for mutable values that don't trigger re-renders (e.g., SDK instances, flags)
- Use `useState` for UI state that triggers re-renders
- Wrap complex async operations in try-catch blocks with proper error logging

### Naming Conventions

- Components: PascalCase (e.g., `App`, `ContentModal`)
- Functions: camelCase (e.g., `startApp`, `executeTool`)
- Constants: camelCase for local, UPPER_SNAKE_CASE for exported
- Refs: descriptive name + `Ref` suffix (e.g., `videoRef`, `wsRef`)
- Hooks: `use` prefix (e.g., `useToolExecution`, `useAppStyles`)
- Fluent UI styles: use `makeStyles` with design tokens from `@fluentui/react-components`

### Code Organization

- **Extract reusable logic** into separate modules (`src/tools/`, `src/utils/`)
- **Use design tokens** from Fluent UI instead of hardcoded values
- **Avoid inline definitions** - extract shaders, configs, large objects
- Keep SDK initialization logic separate from UI rendering
- Use ref patterns for objects that shouldn't trigger re-renders (Speech SDK instances)
- Log important state transitions with timestamps using `getTimestamp()`
- Group related functionality together for readability

### Fluent UI Best Practices

- **Use design tokens** - Import `tokens` from `@fluentui/react-components`
- **No hardcoded colors** - Use `tokens.colorBrandBackground`, `tokens.colorNeutralForeground`, etc.
- **No hardcoded spacing** - Use `tokens.spacingHorizontalM`, `tokens.spacingVerticalL`, etc.
- **No hardcoded timing** - Use `tokens.durationNormal`, `tokens.curveEasyEase`, etc.
- **Button appearances** - Use built-in `appearance` prop (`primary`, `secondary`) instead of custom styles
- Let Fluent components handle their own styling - only override when necessary

### Azure SDK Best Practices

- Store SDK instances in refs, not state
- Clean up resources on component unmount
- Handle SDK errors gracefully with user-friendly messages
- Use async/await for SDK operations
- Implement proper interruption handling for speech operations

## Security Considerations

### Critical Warnings

⚠️ **This is a DEMO application - NOT suitable for production without modifications**

- **Client-side API keys**: Azure keys are exposed in the browser (acceptable for demos only)
- **No authentication**: No user auth or access controls implemented
- **Cost exposure**: Direct Azure API access without rate limiting

### Before Production Deployment

See [SECURITY.md](SECURITY.md) for complete guidance. Key requirements:

1. **Move API calls to backend** - Never expose Azure keys in client code
2. **Implement authentication** - Azure AD B2C, Microsoft Entra ID
3. **Use Managed Identities** - For Azure resource access
4. **Store secrets in Key Vault** - Never in code or environment variables
5. **Add rate limiting** - Prevent abuse and unexpected costs
6. **Enable monitoring** - Application Insights, Cost Management alerts

### Git Security

- ✅ `.env` files in `.gitignore` (never commit secrets)
- ✅ No secrets in code or documentation
- ❌ Don't commit debugging tokens or temporary API keys
- ❌ Don't store production credentials in development environments

## Testing Instructions

### Run Tests

```bash
# Run test suite
npm test

# Run tests with coverage
npm test -- --coverage
```

### Testing Approach

- Tests use Jest and React Testing Library
- Test setup configured in `src/setupTests.ts`
- Follow existing test patterns in `src/App.test.tsx`
- Mock Azure SDK dependencies in tests
- Test user interactions and component rendering, not API calls

## Build and Deployment

### Production Build

```bash
# Create optimized production build (with obfuscation)
npm run build

# Build without obfuscation (for debugging)
cross-env GENERATE_SOURCEMAP=false react-scripts build
```

Build output goes to `build/` directory. The production build includes:

- Code obfuscation via `javascript-obfuscator`
- No source maps (for security)
- Optimized bundle size

### Deployment with Azure Static Web Apps CLI

#### Installation

```bash
npm install -g @azure/static-web-apps-cli
```

#### Deploy to Preview Environment (Default)

```bash
npm run deploy-preview
# or use swa directly
swa deploy --env preview
```

#### Deploy to Production Environment

```bash
npm run deploy-prod
# or use swa directly
swa deploy --env production
```

#### Deployment Options

- Both environments use the same deployment token
- Preview environments are useful for testing before production deployment

### General Deployment Notes

- **Security Warning:** This demo exposes Azure keys in the browser. For production:
  - Move API calls to a backend service
  - Use token-based authentication (Azure AD, Managed Identity)
  - Never commit `.env` files
  - Implement proper CORS and HTTPS
- Serve `build/` directory with any static host (Azure Static Web Apps, nginx, S3, etc.)
- Ensure Azure AI Speech Services region supports Text-to-Speech Avatar features

## Project Background

This project was created by **iLoveAgents.ai** to demonstrate:
- **Azure AI Foundry** Voice Live API capabilities with GPT-4o Realtime
- **Azure Text-to-Speech Avatars** for lifelike conversational experiences
- Production-ready integration patterns for Azure AI services
- Building AI agent assistants (Luna) with specialized expertise

The demo showcases iLoveAgents.ai's expertise in AI agents, Azure AI solutions, and Microsoft AI technologies.

## AI Assistant: Luna

Luna is the AI agents expert assistant featured in this demo:
- **Personality**: Enthusiastic, knowledgeable AI agents specialist
- **Expertise**: AI agents, Azure AI Foundry, intelligent automation, Microsoft AI
- **Purpose**: Demonstrates conversational AI capabilities and iLoveAgents.ai's AI expertise
- **Customization**: System prompt can be modified in `src/config/systemPrompt.ts`

### AI Tools (Function Calling)

Luna can interact with the application using AI tools (function calling):
- **`show_modal`** - Display content (text, markdown, Mermaid diagrams) in UI drawers
- **`query_dom`** - Query page elements via CSS selectors
- **`close_modal`** - Close currently open drawers

Tools are implemented in `src/tools/`. See [src/tools/README.md](src/tools/README.md) for:
- Architecture overview
- How to add new tools
- Testing patterns
- Complete examples
