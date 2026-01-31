// Azure AI Services Configuration
// Environment variables for Azure AI Foundry and Speech Services

export const azureConfig = {
  // Proxy URL for secure backend connection (recommended for production)
  proxyUrl:
    import.meta.env.VITE_PROXY_URL ||
    "ws://localhost:8080/ws?model=gpt-realtime",

  // Avatar character selection
  avatarCharacter: import.meta.env.VITE_AVATAR_CHARACTER || "lisa",

  // Avatar style/pose selection
  avatarStyle: import.meta.env.VITE_AVATAR_STYLE || "casual-standing",

  // Legacy direct connection (not recommended - API keys exposed in browser)
  // Only use for local development/testing
  speechKey: import.meta.env.VITE_AZURE_SPEECH_KEY || "",
  aiFoundryResource:
    import.meta.env.VITE_AZURE_AI_FOUNDRY_RESOURCE ||
    "aif-iloveagents-ttsavatar-dev",
};
