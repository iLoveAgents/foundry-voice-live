/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AZURE_AI_FOUNDRY_RESOURCE: string;
  readonly VITE_AZURE_SPEECH_KEY: string;
  readonly VITE_AVATAR_CHARACTER?: string;
  readonly VITE_AVATAR_STYLE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
