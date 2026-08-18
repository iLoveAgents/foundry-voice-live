/**
 * Upstream URL / auth resolution for the Voice Live proxy.
 *
 * Pure module: no express, no Application Insights, no @azure/identity, no side effects.
 * Everything that needs I/O (Entra token acquisition) is injected via `deps`, which keeps
 * this logic unit-testable without a running server.
 */

import type {
  AuthMethod,
  AzureConnectionConfig,
  ProxyMode,
  QueryParams,
  Transport,
} from "./types.js";

export type { AuthMethod, ProxyMode, Transport } from "./types.js";

/**
 * Default Voice Live API version (GA) for the WebSocket transport.
 * Update when Microsoft ships a new GA version.
 */
export const DEFAULT_API_VERSION = "2026-07-15";

/**
 * Default API version for the WebRTC transport (preview feature).
 * The WebRTC control channel (`rtc.call.*` events) is only documented for preview versions.
 */
export const DEFAULT_WEBRTC_API_VERSION = "2026-01-01-preview";

/** Default model for standard (Voice/Avatar) mode */
export const DEFAULT_MODEL = "gpt-realtime";

/** Entra ID scope for Voice Live / Foundry */
export const ENTRA_SCOPE = "https://ai.azure.com/.default";

/**
 * A problem with the *client's* request (bad/missing query parameters). These messages are safe to
 * send back to the browser; every other failure is reported generically so server-side detail
 * (token acquisition, upstream handshake, DNS) never leaks.
 */
export class ProxyRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProxyRequestError";
  }
}

const REALTIME_PATH = "/voice-live/realtime";
const REALTIME_CALLS_PATH = "/voice-live/realtime/calls";

/**
 * Subset of the proxy configuration needed to build upstream URLs
 */
export interface UrlBuildConfig {
  /** Azure AI Foundry resource name (`<name>.services.ai.azure.com`) */
  azureResourceName: string;
  /** API version from `API_VERSION` env; undefined = built-in default per transport */
  apiVersion?: string;
  /** API key from `FOUNDRY_API_KEY` env (standard mode only) */
  foundryApiKey?: string;
  /** Default agent name from `FOUNDRY_AGENT_NAME` env */
  foundryAgentName?: string;
  /** Default project name from `FOUNDRY_PROJECT_NAME` env */
  foundryProjectName?: string;
}

/**
 * Injected dependencies for `buildAzureUrl`
 */
export interface UrlBuildDeps {
  /** Acquire an Entra ID access token (server-side DefaultAzureCredential) */
  getEntraToken: () => Promise<string>;
}

/**
 * Resolved agent identity (URL params take priority over .env fallback)
 */
export interface ResolvedAgent {
  agentName?: string;
  projectName?: string;
  /** Where `agentName` came from (undefined when not in agent mode) */
  source?: "url" | "env";
}

/**
 * Resolve the transport from the `transport` query parameter.
 * Absent / empty / `websocket` → `websocket`; `webrtc` → `webrtc` (case-insensitive).
 *
 * @throws Error for unknown transport values
 */
export function resolveTransport(query: QueryParams): Transport {
  const raw = query.transport === undefined ? "" : String(query.transport).trim().toLowerCase();
  if (raw === "" || raw === "websocket") {
    return "websocket";
  }
  if (raw === "webrtc") {
    return "webrtc";
  }
  throw new ProxyRequestError(
    `Unsupported transport '${query.transport}' (expected 'websocket' or 'webrtc')`
  );
}

/**
 * Resolve agentName/projectName: URL params take priority, .env as fallback.
 *
 * The .env fallback is only used when the `model` param is absent from the URL,
 * so standard Voice/Avatar requests (which pass model=gpt-realtime) are not
 * accidentally routed through agent mode.
 */
export function resolveAgent(query: QueryParams, cfg: UrlBuildConfig): ResolvedAgent {
  const modelParamAbsent = query.model === undefined;
  const agentName = query.agentName || (modelParamAbsent ? cfg.foundryAgentName : undefined);
  const projectName = query.projectName || (modelParamAbsent ? cfg.foundryProjectName : undefined);

  if (!agentName) {
    return {};
  }
  return { agentName, projectName, source: query.agentName ? "url" : "env" };
}

/**
 * Resolve the connection mode: Foundry Agent when an agent name is present
 * (URL or .env fallback), otherwise standard (Voice/Avatar).
 */
export function resolveMode(query: QueryParams, cfg: UrlBuildConfig): ProxyMode {
  return resolveAgent(query, cfg).agentName ? "foundry-agent" : "standard";
}

/**
 * Resolve the API version: `?apiVersion=` > `API_VERSION` env > built-in default per transport.
 */
export function resolveApiVersion(
  query: QueryParams,
  cfg: UrlBuildConfig,
  transport: Transport
): string {
  return (
    query.apiVersion ||
    cfg.apiVersion ||
    (transport === "webrtc" ? DEFAULT_WEBRTC_API_VERSION : DEFAULT_API_VERSION)
  );
}

/**
 * Serialize `[key, value]` pairs into a query string, encoding every value.
 */
function toQueryString(params: Array<[string, string]>): string {
  return params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
}

/**
 * Build the upstream Azure WebSocket URL and headers for a client connection.
 *
 * Mode is automatically inferred from URL parameters (with .env fallback):
 * - Foundry Agents: if agentName is present (URL or .env)
 * - Standard mode: otherwise (Voice/Avatar)
 *
 * Transport (`?transport=`):
 * - `websocket` (default): `/voice-live/realtime`
 * - `webrtc` (preview): `/voice-live/realtime/calls` (WebRTC control channel)
 *
 * Authentication priority:
 * - Foundry Agents: browser token (`?token=`) > server-side DefaultAzureCredential
 * - Standard mode:  browser token (`?token=`) > `FOUNDRY_API_KEY` > server-side DefaultAzureCredential
 *
 * Tokens are always sent upstream as an `Authorization: Bearer` header (never in the URL).
 *
 * @throws Error when required parameters are missing or the transport is unknown
 */
export async function buildAzureUrl(
  query: QueryParams,
  cfg: UrlBuildConfig,
  deps: UrlBuildDeps
): Promise<AzureConnectionConfig> {
  if (!cfg.azureResourceName) {
    throw new Error("azureResourceName is required (FOUNDRY_RESOURCE_NAME)");
  }

  const transport = resolveTransport(query);
  const mode = resolveMode(query, cfg);
  const apiVersion = resolveApiVersion(query, cfg, transport);
  const path = transport === "webrtc" ? REALTIME_CALLS_PATH : REALTIME_PATH;
  const origin = `wss://${cfg.azureResourceName}.services.ai.azure.com`;
  const params: Array<[string, string]> = [["api-version", apiVersion]];

  const bearer = (token: string): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
  });
  const result = (
    authMethod: AuthMethod,
    headers: Record<string, string>
  ): AzureConnectionConfig => ({
    url: `${origin}${path}?${toQueryString(params)}`,
    headers,
    mode,
    authMethod,
    transport,
  });

  // ===== Foundry Agents: agentName-based =====
  if (mode === "foundry-agent") {
    const { agentName, projectName } = resolveAgent(query, cfg);
    if (!agentName || !projectName) {
      throw new ProxyRequestError(
        "Foundry Agents requires both agentName and projectName (URL params or .env)"
      );
    }

    params.push(["agent-name", agentName], ["agent-project-name", projectName]);
    if (query.conversationId) {
      params.push(["conversation-id", query.conversationId]);
    }
    if (query.agentVersion) {
      params.push(["agent-version", query.agentVersion]);
    }
    if (query.agentAuthenticationIdentityClientId) {
      params.push([
        "agent-authentication-identity-client-id",
        query.agentAuthenticationIdentityClientId,
      ]);
    }
    if (query.foundryResourceOverride) {
      params.push(["foundry-resource-override", query.foundryResourceOverride]);
    }

    // Auth priority: browser token > server-side DefaultAzureCredential
    if (query.token) {
      return result("msal-token", bearer(query.token));
    }
    return result("entra-credential", bearer(await deps.getEntraToken()));
  }

  // ===== Standard mode: Voice/Avatar =====
  params.push(["model", query.model || DEFAULT_MODEL]);

  // Auth priority: browser token > API key > server-side DefaultAzureCredential
  if (query.token) {
    return result("msal-token", bearer(query.token));
  }
  if (cfg.foundryApiKey) {
    params.push(["api-key", cfg.foundryApiKey]);
    return result("api-key", {});
  }
  return result("entra-credential", bearer(await deps.getEntraToken()));
}

/**
 * Mask secrets (`token`, `api-key`, `Authorization`) in a URL query string for logging.
 */
export function redactUrl(url: string): string {
  return url.replace(/([?&])(token|api-key|authorization)=[^&]*/gi, "$1$2=REDACTED");
}
