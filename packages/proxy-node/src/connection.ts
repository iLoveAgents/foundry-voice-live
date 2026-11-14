import type { AzureConnectionConfig, ProxyConfig, QueryParams } from "./types.js";

/** Latest generally available Voice Live protocol version. */
export const DEFAULT_API_VERSION = "2026-07-15";

export function resolveAgentName(query: QueryParams, config: ProxyConfig): string | undefined {
  // Explicit classic-agent and model requests must not inherit a default agent.
  return (
    query.agentName ||
    (query.model === undefined && !query.agentId ? config.foundryAgentName : undefined)
  );
}

/** Build the service connection without starting a server or acquiring credentials at import time. */
export async function buildAzureUrl(
  query: QueryParams,
  config: ProxyConfig,
  getEntraToken: () => Promise<string>
): Promise<AzureConnectionConfig> {
  // Repeated URL parameters parse as arrays. Reject them before treating them as strings.
  for (const value of Object.values(query)) {
    if (value !== undefined && typeof value !== "string") {
      throw new Error("WebSocket query parameters must have a single string value");
    }
  }

  if (
    query.transport !== undefined &&
    query.transport !== "websocket" &&
    query.transport !== "webrtc"
  ) {
    throw new Error("Unsupported transport: use websocket or webrtc");
  }
  const webRtc = query.transport === "webrtc";
  const protocols = webRtc ? ["realtime"] : undefined;
  const url = new URL(
    `wss://${config.azureResourceName}.services.ai.azure.com/voice-live/realtime${webRtc ? "/calls" : ""}`
  );
  url.searchParams.set("api-version", query.apiVersion || config.apiVersion || DEFAULT_API_VERSION);
  if (query.features) url.searchParams.set("features", query.features);
  if (query.foundryResourceOverride)
    url.searchParams.set("foundry-resource-override", query.foundryResourceOverride);

  const agentName = resolveAgentName(query, config);
  const projectName = query.projectName || config.foundryProjectName;
  if (agentName) {
    if (!projectName) {
      throw new Error(
        "Foundry Agents requires both agentName and projectName (URL params or .env)"
      );
    }
    url.searchParams.set("agent-name", agentName);
    url.searchParams.set("agent-project-name", projectName);
    if (query.conversationId) url.searchParams.set("conversation-id", query.conversationId);
    if (query.agentVersion) url.searchParams.set("agent-version", query.agentVersion);
    if (query.authenticationIdentityClientId) {
      url.searchParams.set(
        "agent-authentication-identity-client-id",
        query.authenticationIdentityClientId
      );
    }
    // Agent invocation requires Entra ID, even if a resource API key is configured.
    const token = query.token || (await getEntraToken());
    return { url: url.toString(), protocols, headers: { Authorization: `Bearer ${token}` } };
  }

  if (query.agentId) {
    if (!query.projectName) {
      throw new Error("Agent Service v1 requires both agentId and projectName in URL");
    }
    const agentToken = query.agentAccessToken || query.token;
    if (!agentToken) {
      throw new Error("Agent Service v1 requires token or agentAccessToken parameter (MSAL)");
    }
    url.searchParams.set("agent-id", query.agentId);
    url.searchParams.set("agent-project-name", query.projectName);
    // Classic agent invocation uses a separate token from the Voice Live handshake.
    url.searchParams.set("agent-access-token", agentToken);
  } else {
    url.searchParams.set("model", query.model || "gpt-realtime");
    if (query.profile) url.searchParams.set("profile", query.profile);
  }

  if (query.token) {
    return { url: url.toString(), protocols, headers: { Authorization: `Bearer ${query.token}` } };
  }
  if (config.foundryApiKey) {
    return { url: url.toString(), protocols, headers: { "api-key": config.foundryApiKey } };
  }
  const token = await getEntraToken();
  return { url: url.toString(), protocols, headers: { Authorization: `Bearer ${token}` } };
}

/** Keep credentials out of connection logs, including encoded parameter names. */
export function redactConnectionUrl(value: string): string {
  const url = new URL(value, "http://proxy.local");
  for (const key of [...url.searchParams.keys()]) {
    if (
      ["token", "api-key", "agent-access-token", "agentaccesstoken", "authorization"].includes(
        key.toLowerCase()
      )
    ) {
      url.searchParams.set(key, "REDACTED");
    }
  }
  return `${url.pathname}${url.search}`;
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  return !origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}
