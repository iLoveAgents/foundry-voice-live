/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FOUNDRY_RESOURCE_NAME: string;
  readonly VITE_FOUNDRY_API_KEY: string;
  readonly VITE_AVATAR_CHARACTER?: string;
  readonly VITE_AVATAR_STYLE?: string;
  readonly VITE_AZURE_CLIENT_ID?: string;
  readonly VITE_AZURE_TENANT_ID?: string;
  readonly VITE_FOUNDRY_AGENT_ID?: string;
  readonly VITE_FOUNDRY_PROJECT_NAME?: string;
  readonly VITE_BACKEND_PROXY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
