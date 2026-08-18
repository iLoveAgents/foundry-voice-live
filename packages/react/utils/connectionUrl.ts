/**
 * Voice Live connection URL builder.
 *
 * Pure functions (no React, no side effects) that turn a `VoiceLiveConnectionConfig`
 * into the WebSocket URL used for the session (or the WebRTC control channel).
 *
 * Auth in the browser follows the documented query-parameter forms:
 * - API key:      `?api-key=<key>`
 * - Entra token:  `?Authorization=Bearer%20<token>`
 *
 * @see https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-how-to#authentication
 */

import type { VoiceLiveConnectionConfig, VoiceLiveSessionConfig } from '../types/voiceLive';
import {
  DEFAULT_API_VERSION,
  DEFAULT_WEBRTC_API_VERSION,
  MIN_WEBRTC_API_VERSION,
  DEFAULT_MODEL,
} from './constants';

/** How the connection is established */
export type ConnectionMode = 'proxy' | 'foundry-agent' | 'standard';

/** Result of `buildVoiceLiveUrl` */
export interface ResolvedConnection {
  /** WebSocket URL to open */
  url: string;
  /** Connection mode */
  mode: ConnectionMode;
  /** True when the session must use the agent session builder */
  isAgentMode: boolean;
  /** Human-readable label for logs */
  modeLabel: string;
}

const REALTIME_PATH = 'voice-live/realtime';
const REALTIME_CALLS_PATH = 'voice-live/realtime/calls';

/**
 * Determine the connection mode from the connection config.
 * `proxyUrl` wins over everything; `agentName` + `projectName` selects agent mode.
 */
export function resolveConnectionMode(connection: VoiceLiveConnectionConfig): ConnectionMode {
  if (connection.proxyUrl) return 'proxy';
  if (connection.agentName) return 'foundry-agent';
  return 'standard';
}

/**
 * Parse a proxy URL, tolerating relative URLs (`/voice-live`) that browsers accept for
 * `new WebSocket()`. Returns the parsed URL and a serializer that preserves relative form.
 */
function parseProxyUrl(url: string): { parsed: URL; serialize: (u: URL) => string } {
  const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(url);
  const parsed = new URL(url, isAbsolute ? undefined : 'ws://relative.invalid');
  const serialize = (u: URL): string =>
    isAbsolute ? u.toString() : `${u.pathname}${u.search}${u.hash}`;
  return { parsed, serialize };
}

/**
 * Detect agent mode for a proxy URL (the proxy resolves the mode from its query params
 * or its own .env; `agentMode` lets the caller force it).
 */
function isProxyAgentMode(connection: VoiceLiveConnectionConfig, parsed: URL): boolean {
  if (connection.agentMode !== undefined) return connection.agentMode;
  return parsed.searchParams.has('agentName') || parsed.searchParams.has('projectName');
}

/**
 * Compare API version strings (`YYYY-MM-DD[-preview]`) chronologically.
 * Returns negative when a < b, 0 when equal dates, positive when a > b.
 */
export function compareApiVersions(a: string, b: string): number {
  const date = (v: string): string => v.slice(0, 10);
  return date(a).localeCompare(date(b));
}

/**
 * Build the WebSocket URL for a Voice Live session (or WebRTC control channel).
 *
 * @throws Error when required credentials/parameters are missing
 */
export function buildVoiceLiveUrl(connection: VoiceLiveConnectionConfig): ResolvedConnection {
  const transport = connection.transport ?? 'websocket';
  const mode = resolveConnectionMode(connection);

  // ===== Proxy mode: URL is used as-is (proxy holds credentials / mode) =====
  if (mode === 'proxy') {
    const { parsed, serialize } = parseProxyUrl(connection.proxyUrl as string);
    // Explicit connection settings win over params already present in the proxy URL.
    // The proxy honours ?transport= and ?apiVersion= for both transports.
    const overrides: Record<string, string> = {};
    // Per-user auth through a proxy travels as `?token=`. `getToken` refreshes it on every
    // (re)connect, so it must replace whatever the caller's URL carries — otherwise the proxy
    // silently falls back to its own identity, or keeps using an expired token.
    if (connection.token) {
      overrides.token = connection.token;
    }
    if (transport === 'webrtc') {
      overrides.transport = 'webrtc';
    } else if (parsed.searchParams.get('transport') === 'webrtc') {
      // A reused proxy URL must not route this socket to the WebRTC control endpoint while the
      // SDK speaks the WebSocket protocol on it
      overrides.transport = 'websocket';
    }
    if (connection.apiVersion) overrides.apiVersion = connection.apiVersion;
    for (const [key, value] of Object.entries(overrides)) {
      parsed.searchParams.set(key, value);
    }
    const isAgentMode = isProxyAgentMode(connection, parsed);
    return {
      // Leave the caller's URL byte-for-byte untouched when nothing was added
      url: Object.keys(overrides).length > 0 ? serialize(parsed) : (connection.proxyUrl as string),
      mode,
      isAgentMode,
      modeLabel: isAgentMode ? 'Proxy (Foundry Agent)' : 'Proxy (Standard)',
    };
  }

  if (!connection.resourceName) {
    throw new Error('resourceName is required for direct connections (or use proxyUrl).');
  }

  const path = transport === 'webrtc' ? REALTIME_CALLS_PATH : REALTIME_PATH;
  const apiVersion =
    connection.apiVersion ?? (transport === 'webrtc' ? DEFAULT_WEBRTC_API_VERSION : DEFAULT_API_VERSION);
  const base = `wss://${connection.resourceName}.services.ai.azure.com/${path}?api-version=${encodeURIComponent(apiVersion)}`;

  // ===== Foundry Agents =====
  if (mode === 'foundry-agent') {
    if (!connection.projectName) {
      throw new Error('projectName is required together with agentName (Foundry Agents).');
    }
    if (!connection.token) {
      throw new Error(
        'Foundry Agents require an Entra ID token: pass `token`, or use `proxyUrl` (recommended for production).'
      );
    }

    let url =
      `${base}&agent-name=${encodeURIComponent(connection.agentName as string)}` +
      `&agent-project-name=${encodeURIComponent(connection.projectName)}`;

    if (connection.conversationId) {
      url += `&conversation-id=${encodeURIComponent(connection.conversationId)}`;
    }
    if (connection.agentVersion) {
      url += `&agent-version=${encodeURIComponent(connection.agentVersion)}`;
    }
    if (connection.agentAuthenticationIdentityClientId) {
      url += `&agent-authentication-identity-client-id=${encodeURIComponent(connection.agentAuthenticationIdentityClientId)}`;
    }
    if (connection.foundryResourceOverride) {
      url += `&foundry-resource-override=${encodeURIComponent(connection.foundryResourceOverride)}`;
    }

    url += `&Authorization=${encodeURIComponent(`Bearer ${connection.token}`)}`;

    return { url, mode, isAgentMode: true, modeLabel: 'Foundry Agent' };
  }

  // ===== Standard (model) mode =====
  const model = connection.model || DEFAULT_MODEL;
  let url = `${base}&model=${encodeURIComponent(model)}`;

  if (connection.token) {
    url += `&Authorization=${encodeURIComponent(`Bearer ${connection.token}`)}`;
  } else if (connection.apiKey) {
    url += `&api-key=${encodeURIComponent(connection.apiKey)}`;
  } else {
    throw new Error('Standard mode requires apiKey or token (or use proxyUrl).');
  }

  return { url, mode, isAgentMode: false, modeLabel: `Standard (${model})` };
}

/**
 * Validate transport-specific constraints before connecting.
 *
 * @throws Error when the WebRTC transport is requested with an unsupported configuration
 */
export function validateTransport(
  connection: VoiceLiveConnectionConfig,
  session?: VoiceLiveSessionConfig,
  hasRtcPeerConnection: boolean = typeof RTCPeerConnection !== 'undefined'
): void {
  if ((connection.transport ?? 'websocket') !== 'webrtc') return;

  if (session?.avatar) {
    throw new Error(
      "Avatar is not supported over the WebRTC transport (preview). Use transport: 'websocket' for avatar sessions."
    );
  }

  if (connection.apiVersion && compareApiVersions(connection.apiVersion, MIN_WEBRTC_API_VERSION) < 0) {
    throw new Error(
      `The WebRTC transport requires api-version ${MIN_WEBRTC_API_VERSION} or later (got ${connection.apiVersion}).`
    );
  }

  if (!hasRtcPeerConnection) {
    throw new Error("RTCPeerConnection is not available in this environment; use transport: 'websocket'.");
  }
}

/**
 * Mask secrets (api-key, Authorization, token) in a URL for logging.
 */
export function redactUrl(url: string): string {
  return url.replace(/([?&])(api-key|Authorization|authorization|token)=[^&]*/g, '$1$2=***');
}
