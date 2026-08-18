import { DEFAULT_MODEL } from '@iloveagents/foundry-voice-live-react';
import type { VoiceLiveConnectionConfig } from '@iloveagents/foundry-voice-live-react';

/** Proxy origin used when `VITE_BACKEND_PROXY_URL` is not set (see packages/proxy-node) */
export const DEFAULT_PROXY_BASE = 'ws://localhost:8080';

/** Proxy origin from `VITE_BACKEND_PROXY_URL`, falling back to `DEFAULT_PROXY_BASE` */
export function getProxyBaseUrl(): string {
  return import.meta.env.VITE_BACKEND_PROXY_URL || DEFAULT_PROXY_BASE;
}

/**
 * Proxy WebSocket URL (`<base>/ws`) with the given params appended as a query string,
 * e.g. `proxyWsUrl({ model: 'gpt-realtime' })`. Params with an undefined or empty
 * value are omitted, so optional env vars can be passed straight through.
 */
export function proxyWsUrl(params: Record<string, string | undefined> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return `${getProxyBaseUrl()}/ws${query ? `?${query}` : ''}`;
}

/**
 * Direct connection with the dev API key when one is configured; otherwise route
 * through the proxy (API key or DefaultAzureCredential on the server).
 *
 * `model` and other options are passed straight to `useVoiceLive` in direct mode and
 * appended as query parameters in proxy mode, so pages work in both setups.
 */
export function directOrProxyConnection(
  options: Pick<VoiceLiveConnectionConfig, 'model' | 'transport' | 'apiVersion'> = {}
): VoiceLiveConnectionConfig {
  const { model, ...rest } = options;
  const apiKey = import.meta.env.VITE_FOUNDRY_API_KEY;
  const resourceName = import.meta.env.VITE_FOUNDRY_RESOURCE_NAME;

  if (apiKey && resourceName) {
    return { resourceName, apiKey, model, ...rest };
  }

  // Always name the model for the proxy: without a `model` param the proxy falls back to its
  // .env Foundry agent (if configured), which would turn a standard-mode page into an agent session.
  return { proxyUrl: proxyWsUrl({ model: model ?? DEFAULT_MODEL }), ...rest };
}

/** True when the page runs against the proxy (no `VITE_FOUNDRY_API_KEY`) */
export function isProxyMode(): boolean {
  return !(import.meta.env.VITE_FOUNDRY_API_KEY && import.meta.env.VITE_FOUNDRY_RESOURCE_NAME);
}
