/**
 * Microsoft Foundry Voice Live Proxy - Type Definitions
 */

/**
 * Connection mode, inferred from the client query parameters (with .env fallback)
 * - `foundry-agent`: Foundry Agents (agentName + projectName)
 * - `standard`: Voice / Avatar with a model
 */
export type ProxyMode = "foundry-agent" | "standard";

/**
 * How the upstream connection is authenticated
 * - `msal-token`: Bearer token passed by the browser (`?token=`), moved to the Authorization header
 * - `api-key`: `FOUNDRY_API_KEY` from the proxy environment (standard mode only)
 * - `entra-credential`: server-side `DefaultAzureCredential` (az login, managed identity, ...)
 */
export type AuthMethod = "msal-token" | "entra-credential" | "api-key";

/**
 * Transport requested by the client
 * - `websocket`: audio and events over the WebSocket (default)
 * - `webrtc`: WebSocket is the WebRTC control channel (`/voice-live/realtime/calls`, preview)
 */
export type Transport = "websocket" | "webrtc";

/**
 * Query parameters from WebSocket connection URL
 *
 * Mode is automatically inferred:
 * - Foundry Agents: If agentName is provided (URL or .env fallback)
 * - Standard mode: Otherwise (or if model param is present)
 */
export interface QueryParams {
  /** Model name for standard mode (default: gpt-realtime) */
  model?: string;
  /** MSAL Bearer token for authentication (or auto-acquired via DefaultAzureCredential) */
  token?: string;
  /** Agent name for Foundry Agents - triggers agent mode when present */
  agentName?: string;
  /** Project name - required alongside agentName */
  projectName?: string;
  /** Resume conversation (Foundry Agents) */
  conversationId?: string;
  /** Pin agent version (Foundry Agents) */
  agentVersion?: string;
  /** Client ID of the user-assigned managed identity used for agent authentication (Foundry Agents) */
  agentAuthenticationIdentityClientId?: string;
  /** Override the Foundry resource used by the agent (Foundry Agents) */
  foundryResourceOverride?: string;
  /** Override API version (default: API_VERSION env or built-in default) */
  apiVersion?: string;
  /** Transport: `websocket` (default) or `webrtc` (preview, WebRTC control channel) */
  transport?: string;
}

/**
 * Azure WebSocket connection configuration (resolved upstream connection)
 */
export interface AzureConnectionConfig {
  /** Upstream wss:// URL (may contain `api-key`; redact before logging) */
  url: string;
  /** Upstream headers (e.g. `Authorization: Bearer ...`) */
  headers: Record<string, string>;
  /** Resolved connection mode */
  mode: ProxyMode;
  /** Resolved authentication method */
  authMethod: AuthMethod;
  /** Resolved transport */
  transport: Transport;
}

/**
 * Proxy server configuration
 */
export interface ProxyConfig {
  port: number;
  apiVersion?: string; // Optional: API_VERSION env; undefined = built-in default per transport
  azureResourceName: string;
  foundryApiKey?: string; // Optional: for anonymous API key auth
  foundryAgentName?: string; // Optional: default agent name from .env
  foundryProjectName?: string; // Optional: default project name from .env
}

/**
 * Security configuration for proxy server
 */
export interface SecurityConfig {
  allowedOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMax: number;
  maxConnections: number;
}

/**
 * Environment variable configuration
 */
export interface EnvironmentConfig {
  PORT?: string;
  API_VERSION?: string;
  FOUNDRY_RESOURCE_NAME?: string;
  FOUNDRY_API_KEY?: string;
  FOUNDRY_AGENT_NAME?: string;
  FOUNDRY_PROJECT_NAME?: string;
  ALLOWED_ORIGINS?: string;
  RATE_LIMIT_WINDOW_MS?: string;
  RATE_LIMIT_MAX_REQUESTS?: string;
  MAX_CONNECTIONS?: string;
  APPLICATIONINSIGHTS_CONNECTION_STRING?: string;
}

/**
 * Logger interface for telemetry
 */
export interface Logger {
  info(message: string, properties?: Record<string, any>): void;
  warn(message: string, properties?: Record<string, any>): void;
  error(message: string, error?: Error, properties?: Record<string, any>): void;
  trackEvent(name: string, properties?: Record<string, any>): void;
  trackMetric(name: string, value: number, properties?: Record<string, any>): void;
}
