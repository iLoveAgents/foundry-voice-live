# Azure Live Voice Avatar

An interactive demo by [iLoveAgents.ai](https://iLoveAgents.ai) showcasing **Azure AI Foundry Voice Live API** (GPT-4o Realtime) combined with **Azure Text-to-Speech Avatars** to create Luna, an AI agents expert assistant.

This project demonstrates the cutting-edge capabilities of Azure AI Foundry's real-time conversational AI with lifelike avatar integration.

## Architecture

This demo uses a **secure proxy architecture** with:
- **React Frontend** (`@iloveagents/foundry-voice-live-react` library) - Client-side UI and avatar rendering
- **Node.js Proxy Server** (`server/proxy`) - Backend WebSocket proxy that securely injects Azure API keys
- **Azure AI Foundry** - Cloud AI services (Voice Live API + TTS Avatar)

This architecture ensures API keys never reach the browser, making it suitable for production deployment.

## Overview

**azure-live-voice-avatar** is a prototype single-page React application that showcases how to:

- Stream microphone audio directly to **Azure AI Foundry Voice Live API** for natural, low-latency conversations using GPT-4o Realtime
- Render **Azure AI Text-to-Speech Avatars** with GPU-accelerated WebGL chroma key for transparent backgrounds
- Implement Azure AI Foundry session management with real-time audio streaming
- Expose AI assistant-side tools such as modal overlays and DOM inspection
- Present contextual information using Microsoft Fluent UI components (text, markdown, mermaid diagrams)
- Demonstrate production-ready patterns for Azure AI Foundry integration

Created by the AI agents experts at **iLoveAgents.ai** to showcase Azure AI Foundry capabilities.

## Features

- **Luna** - AI agents expert assistant powered by Azure AI Foundry Voice Live API (GPT-4o Realtime)
- **Azure Text-to-Speech Avatar** video playback with WebGL transparent background compositing
- **Azure AI Foundry** real-time audio streaming and session management
- Server-side **voice activity detection** (VAD) for natural turn-taking
- Custom **assistant tools** for showing content (modals, drawers) and querying the DOM
- Configurable **avatar character/style** and system prompt
- **Microsoft Fluent UI** design system integration
- Built by **iLoveAgents.ai** - specialists in AI agents and Azure AI solutions

## Prerequisites

- Node.js 18+ and npm 8+
- **Azure AI Foundry** resource with Voice Live API access
  - GPT-4o Realtime Preview deployment in Azure AI Foundry
  - Azure AI Speech Services with Text-to-Speech Avatar features enabled in your region
- Modern browser with microphone + WebRTC support (Chrome or Edge recommended)
- Azure subscription with access to Azure AI Foundry and Azure AI Services

## Environment Variables

### Proxy Server Configuration (Required)

The proxy server handles Azure authentication securely. Configure `server/proxy/.env`:

```env
# Azure AI Foundry resource name
AZURE_AI_FOUNDRY_RESOURCE=your-resource-name

# Azure API key (secured server-side)
AZURE_SPEECH_KEY=your-api-key

# Server settings
PORT=8080
ALLOWED_ORIGINS=http://localhost:3000
```

See [server/proxy/.env.example](../../server/proxy/.env.example) for full configuration options.

### Avatar Demo Configuration (Optional)

The avatar demo defaults to using the local proxy. Configure `demos/avatar/.env` only if you need to override defaults:

```env
# Proxy URL (defaults to ws://localhost:8080/ws?model=gpt-realtime)
# VITE_PROXY_URL=ws://localhost:8080/ws?model=gpt-realtime

# Avatar customization
# VITE_AVATAR_CHARACTER=lisa
# VITE_AVATAR_STYLE=casual-standing
```

See [.env.example](./.env.example) for template.

## Local Development

### From Repository Root (Recommended)

The monorepo includes scripts to run both proxy and avatar together:

```bash
# Install all dependencies
npm install

# Start both proxy and avatar dev servers
npm run dev
```

This starts:
- Proxy server at `ws://localhost:8080`
- Avatar demo at `http://localhost:3000`

### Individual Services

**Start Proxy Server:**

```bash
cd server/proxy
npm install
npm run dev
```

**Start Avatar Demo:**

```bash
cd demos/avatar
npm install
npm run dev
```

Open `http://localhost:3000` and click **Start**. Grant microphone access when prompted.

## Testing

Run the Vitest test suite:

```bash
npm test
```

## Build

Create an optimized production build (with JavaScript obfuscation):

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

Serve the generated `build/` directory with your preferred static hosting provider. For production workloads, move sensitive API calls to a secured backend.

## AI Tools (Function Calling)

This demo includes a **modular AI tools architecture** that allows Luna to interact with the UI. Tools are defined in `src/tools/`:

- **`show_modal`** - Display content (text, markdown, Mermaid diagrams) in a drawer
- **`query_dom`** - Query page elements via CSS selectors
- **`close_modal`** - Close the currently open drawer

Try asking Luna: *"Show me a diagram of how AI agents work"* or *"What's on this page right now?"*

### Adding New Tools

See **[src/tools/README.md](src/tools/README.md)** for a complete guide on implementing custom tools for your AI assistant.

## Production Deployment

### Frontend (Avatar Demo)

Deploy the React app to Azure Static Web Apps, Azure Storage Static Website, or any static hosting:

```bash
npm run build
```

Upload the `build/` directory to your hosting provider.

**Environment Variables** (if needed):
- `VITE_PROXY_URL` - Your production proxy URL (e.g., `wss://yourapp.com/ws?model=gpt-realtime`)

### Backend (Proxy Server)

Deploy the proxy server to:
- **Azure Container Apps** (recommended) - Serverless containers with autoscaling
- **Azure App Service** - PaaS for Node.js applications
- **Azure Kubernetes Service** (AKS) - For enterprise deployments

**Required Configuration:**
- Set environment variables: `AZURE_AI_FOUNDRY_RESOURCE`, `AZURE_SPEECH_KEY`
- Configure CORS: `ALLOWED_ORIGINS` (your frontend domain)
- Store secrets in Azure Key Vault
- Use Managed Identity for Azure resource access

See [server/proxy/README.md](../../server/proxy/README.md) for detailed deployment instructions.

## Security & Production Guidance

✅ **This demo uses a secure proxy architecture** that keeps Azure API keys server-side, making it suitable for production deployment.

**Production Deployment Checklist:**
- ✅ API keys secured in backend proxy (never exposed to browser)
- ✅ Proxy server handles all Azure AI Foundry communication
- ✅ Client sends requests to proxy, proxy injects credentials
- ☐ Deploy proxy server to Azure (Container Apps, App Service, or AKS)
- ☐ Store secrets in Azure Key Vault (not environment variables)
- ☐ Use Managed Identities for Azure resource access (recommended)
- ☐ Implement user authentication (Azure AD B2C, Microsoft Entra ID) if needed
- ☐ Configure rate limiting and cost monitoring in proxy
- ☐ Set up proper CORS and HTTPS policies
- ☐ Enable Application Insights for monitoring

**Security Best Practices:**
- Never commit `.env` files to git (✅ already configured in `.gitignore`)
- Use Azure Cost Management alerts to prevent unexpected charges
- Enable Application Insights for monitoring
- Perform security audits and penetration testing
- Review proxy server security configuration regularly

See [server/proxy/README.md](../../server/proxy/README.md) for proxy deployment guide.

## Troubleshooting

- **`throwIfNullOrWhitespace: subscriptionKey`** — Verify `.env` values and restart the dev server.
- **Avatar does not appear** — Confirm your Speech resource supports avatars and check browser console logs.
- **Microphone not detected** — Allow browser microphone permissions and close other apps using the device.
- **Voice session not connecting** — Double-check the Azure AI Foundry resource name and API key, then restart the session.

## Customization

- **System Prompt**: Edit `src/config/systemPrompt.ts` to customize Luna's personality and expertise
- **Avatar Settings**: Change `VITE_AVATAR_CHARACTER` and `VITE_AVATAR_STYLE` in `.env` for different personas
- **AI Tools**: Add new tools in `src/tools/` - see [tools README](src/tools/README.md) for guide
- **Theme & Styling**: Modify `src/theme/iLoveAgentsTheme.ts` and `src/styles/App.styles.ts`
- **Voice Configuration**: Customize voice and session settings in `src/App.tsx` using the React library's configuration helpers

## About iLoveAgents.ai

This demo was created by [iLoveAgents.ai](https://iLoveAgents.ai), specialists in AI agents and Azure AI solutions. We help organizations build and deploy intelligent AI agents using Microsoft technologies including Azure AI Foundry, Azure OpenAI, Microsoft 365 Copilot, and Power Platform.

Learn more about our AI agent expertise, workshops, and consulting services at **iLoveAgents.ai**.

## Keywords

Azure AI Foundry, Voice Live API, GPT-4o Realtime, Azure Text-to-Speech Avatar, Azure AI Services, Azure Speech Services, AI agents, conversational AI, real-time AI, WebRTC, Microsoft Fluent UI, React TypeScript, iLoveAgents
