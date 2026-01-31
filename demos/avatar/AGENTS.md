# Avatar Demo

Full-featured demo with Azure Text-to-Speech Avatars and Luna AI assistant.

## Commands

```bash
just dev-avatar           # Start dev server
npm start                 # Alternative
npm run build             # Production build
npm run deploy-prod       # Deploy to Azure Static Web Apps
```

## Setup

```bash
cp .env.example .env
```

Edit `.env` with Azure credentials. Never commit this file.

## Environment

| Variable | Required | Default |
| -------- | -------- | ------- |
| `REACT_APP_AZURE_SPEECH_KEY` | Yes | - |
| `REACT_APP_AZURE_AI_FOUNDRY_RESOURCE` | No | `aif-iloveagents-ttsavatar-dev` |
| `REACT_APP_AVATAR_CHARACTER` | No | `lisa` |
| `REACT_APP_AVATAR_STYLE` | No | `casual-standing` |

## Structure

```text
src/
  config/           # Azure configuration, system prompt
  theme/            # Fluent UI theme
  styles/           # CSS-in-JS with Fluent tokens
  tools/            # AI function calling
  utils/            # Utilities including chromaKey shader
  components/       # React components
```

## AI Tools

| Tool | Description |
| ---- | ----------- |
| `show_modal` | Display content in drawers (text, markdown, Mermaid) |
| `query_dom` | Query page elements via CSS selectors |
| `close_modal` | Close open drawers |

See `src/tools/README.md` for implementation details.

## Fluent UI

- Import `tokens` from `@fluentui/react-components`
- Use design tokens for colors, spacing, timing
- Use `makeStyles` for component styles
- Avoid overriding Fluent component internals

## Security

This demo exposes Azure keys client-side. For production:

1. Move API calls to backend
2. Use Azure AD or Managed Identity
3. Add rate limiting
4. See `SECURITY.md`
