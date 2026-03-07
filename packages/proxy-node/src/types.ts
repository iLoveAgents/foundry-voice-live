/**
 * Microsoft Foundry Voice Live Proxy - Type Definitions
 */

/**
 * Query parameters from WebSocket connection URL
 *
 * Mode is automatically inferred:
 * - Foundry Agent Service: If agentName is provided (URL or .env fallback)
 * - Agent Service (classic): If agentId is provided
 * - Standard mode: Otherwise (or if model param is present)
 */
export interface QueryParams {
  /** Model name for standard mode (default: gpt-realtime) */
  model?: string;
  /** MSAL Bearer token for authentication (or auto-acquired via Azure CLI) */
  token?: string;
  /** Agent ID for Agent Service v1 (classic) - triggers agent mode when present */
  agentId?: string;
  /** Agent name for Foundry Agents v2 - triggers agent mode when present */
  agentName?: string;
  /** Project name - required alongside agentId or agentName */
  projectName?: string;
  /** Resume conversation (Foundry Agents v2) */
  conversationId?: string;
  /** Pin agent version (Foundry Agents v2) */
  agentVersion?: string;
  /** Override API version (default: from proxy config) */
  apiVersion?: string;
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
 */
export interface ProxyConfig {
  port: number;
  apiVersion: string;
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
