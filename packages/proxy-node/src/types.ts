/**
 * Microsoft Foundry Voice Live Proxy - Type Definitions
 */

/**
 * Connection mode for Microsoft Foundry Voice Live API
 * Note: Mode is automatically inferred from URL parameters (agentId/projectName presence)
 */
export type ConnectionMode = "standard" | "agent";

/**
 * Query parameters from WebSocket connection URL
 *
 * Mode is automatically inferred:
 * - Agent mode: If agentId or projectName is provided
 * - Standard mode: Otherwise
 */
export interface QueryParams {
  /** @deprecated Mode is now auto-detected from agentId/projectName presence */
  mode?: ConnectionMode;
  /** Model name for standard mode (default: gpt-realtime) */
  model?: string;
  /** MSAL Bearer token for authentication */
  token?: string;
  /** Agent ID - triggers agent mode when present */
  agentId?: string;
  /** Project name - triggers agent mode when present */
  projectName?: string;
}

/**
 * Azure WebSocket connection configuration
 */
export interface AzureConnectionConfig {
  url: string;
  headers: Record<string, string>;
}

/**
 * Proxy server configuration
 * Agent parameters (agentId, projectName) must be provided by client in URL
 */
export interface ProxyConfig {
  port: number;
  apiVersion: string;
  azureResourceName: string;
  azureSpeechKey?: string; // Optional: for anonymous API key auth
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
  AZURE_AI_FOUNDRY_RESOURCE?: string;
  AZURE_SPEECH_KEY?: string;
  AGENT_ID?: string;
  PROJECT_NAME?: string;
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
