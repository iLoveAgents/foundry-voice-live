/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROXY_URL?: string;
  readonly VITE_AVATAR_CHARACTER?: string;
  readonly VITE_AVATAR_STYLE?: string;
  // Legacy - not recommended for production
  readonly VITE_AZURE_SPEECH_KEY?: string;
  readonly VITE_AZURE_AI_FOUNDRY_RESOURCE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
