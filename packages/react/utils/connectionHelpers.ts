import type { VoiceLiveConnectionConfig } from '../types/voiceLive';

export const DEFAULT_API_VERSION = '2026-07-15';

export interface VoiceLiveConnectionUrl {
  url: string;
  isAgentMode: boolean;
  transport: 'websocket' | 'webrtc';
}

/** Build browser WebSocket URLs without relying on unsupported custom headers. */
export function buildConnectionUrl(connection: VoiceLiveConnectionConfig): VoiceLiveConnectionUrl {
  if (connection.proxyUrl) {
    const url = new URL(connection.proxyUrl);
    // URL parameters take precedence over optional typed connection settings.
    const parameters: Record<string, string | undefined> = {
      transport: connection.transport,
      apiVersion: connection.apiVersion,
      model: connection.model,
      agentName: connection.agentName,
      agentId: connection.agentId,
      projectName: connection.projectName,
      agentVersion: connection.agentVersion,
      conversationId: connection.conversationId,
      token: connection.token,
      agentAccessToken: connection.agentAccessToken,
      profile: connection.profile,
      authenticationIdentityClientId: connection.authenticationIdentityClientId,
      foundryResourceOverride: connection.foundryResourceOverride,
      features: connection.previewFeatures?.map((feature) => `${feature}:true`).join(','),
    };
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined && !url.searchParams.has(key)) url.searchParams.set(key, value);
    }
    const isAgentMode = connection.agentMode ?? ['agentName', 'agentId', 'agent-name', 'agent-id']
      .some((key) => Boolean(url.searchParams.get(key)));
    const transport = parseTransport(url.searchParams.get('transport') ?? 'websocket');
    return { url: url.toString(), isAgentMode, transport };
  }

  if (!connection.resourceName) throw new Error('resourceName is required for a direct connection.');
  if ((connection.agentName || connection.agentId) && !connection.projectName) {
    throw new Error('projectName is required for an agent connection.');
  }
  const transport = parseTransport(connection.transport ?? 'websocket');
  const url = new URL(`wss://${connection.resourceName}.services.ai.azure.com/voice-live/realtime${transport === 'webrtc' ? '/calls' : ''}`);
  url.searchParams.set('api-version', connection.apiVersion ?? DEFAULT_API_VERSION);
  const isAgentMode = Boolean(connection.agentName || connection.agentId);
  if (isAgentMode) {
    url.searchParams.set(connection.agentName ? 'agent-name' : 'agent-id', connection.agentName ?? connection.agentId!);
    url.searchParams.set('agent-project-name', connection.projectName!);
    if (connection.agentVersion) url.searchParams.set('agent-version', connection.agentVersion);
    if (connection.authenticationIdentityClientId) url.searchParams.set('agent-authentication-identity-client-id', connection.authenticationIdentityClientId);
    if (connection.conversationId) url.searchParams.set('conversation-id', connection.conversationId);
  } else {
    url.searchParams.set('model', connection.model ?? 'gpt-realtime');
  }
  if (connection.profile) url.searchParams.set('profile', connection.profile);
  if (connection.foundryResourceOverride) url.searchParams.set('foundry-resource-override', connection.foundryResourceOverride);
  if (connection.agentId && !connection.agentName) {
    const agentToken = connection.agentAccessToken ?? connection.token;
    if (!agentToken) throw new Error('Classic agent connections require agentAccessToken or token.');
    url.searchParams.set('agent-access-token', agentToken);
  }

  // A browser cannot set Authorization headers on WebSocket upgrade requests.
  const token = connection.token ?? (connection.apiKey ? undefined : connection.agentAccessToken);
  if (token) {
    url.searchParams.set('Authorization', `Bearer ${token}`);
  } else if (!connection.agentName && connection.apiKey) {
    url.searchParams.set('api-key', connection.apiKey);
  } else {
    throw new Error(isAgentMode
      ? 'Agent connections require an Entra token or a proxyUrl.'
      : 'A direct connection requires an apiKey or Entra token.');
  }
  if (connection.previewFeatures?.length) {
    url.searchParams.set('features', connection.previewFeatures.map((feature) => `${feature}:true`).join(','));
  }
  return { url: url.toString(), isAgentMode: connection.agentMode ?? isAgentMode, transport };
}

function parseTransport(value: string): 'websocket' | 'webrtc' {
  if (value === 'websocket' || value === 'webrtc') return value;
  throw new Error('transport must be websocket or webrtc.');
}

/** Redact all supported authentication query parameters before logging. */
export function redactConnectionUrl(value: string): string {
  const url = new URL(value);
  for (const key of Array.from(url.searchParams.keys())) {
    if (['authorization', 'api-key', 'token', 'agent-access-token', 'agentaccesstoken'].includes(key.toLowerCase())) {
      url.searchParams.set(key, 'REDACTED');
    }
  }
  return url.toString();
}
