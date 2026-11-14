import { DEFAULT_MODEL } from '@iloveagents/foundry-voice-live-react';
import type { VoiceLiveConnectionConfig } from '@iloveagents/foundry-voice-live-react';

/** Proxy origin used when `VITE_BACKEND_PROXY_URL` is not set (see packages/proxy-node) */
export const DEFAULT_PROXY_BASE = 'ws://localhost:8080';

/**
 * Proxy origin from `VITE_BACKEND_PROXY_URL`, falling back to `DEFAULT_PROXY_BASE`.
 * Trailing slashes are stripped: `ws://proxy.example/` would otherwise produce `//ws`, which the
 * proxy does not serve (it registers `/ws`).
 */
export function getProxyBaseUrl(): string {
  const base = import.meta.env.VITE_BACKEND_PROXY_URL || DEFAULT_PROXY_BASE;
  return base.replace(/\/+$/, '').replace(/\/ws$/, '');
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
 * Route examples through the proxy; credentials stay on the server.
 *
 * `model` and other options are passed straight to `useVoiceLive` in direct mode and
 * appended as query parameters in proxy mode, so pages work in both setups.
 */
export function directOrProxyConnection(
  options: Pick<
    VoiceLiveConnectionConfig,
    'model' | 'transport' | 'apiVersion' | 'profile' | 'foundryResourceOverride'
  > = {}
): VoiceLiveConnectionConfig {
  const { model, profile, foundryResourceOverride, ...rest } = options;
  // Always name the model for the proxy: without a `model` param the proxy falls back to its
  // .env Foundry agent (if configured), which would turn a standard-mode page into an agent session.
  // BYOM settings are proxy query params too; the SDK would also add them from the config, but
  // naming them here keeps the URL readable in the network tab.
  return {
    proxyUrl: proxyWsUrl({ model: model ?? DEFAULT_MODEL, profile, foundryResourceOverride }),
    ...rest,
  };
}
