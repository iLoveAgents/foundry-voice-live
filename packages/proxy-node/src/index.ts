#!/usr/bin/env node

/**
 * Microsoft Foundry Voice Live Proxy Server
 *
 * Transparent WebSocket proxy for Microsoft Foundry Voice Live API with two main responsibilities:
 * 1. Move MSAL token from URL to Authorization header (browser WebSocket limitation)
 * 2. Hide API key on server side (not exposed to browser)
 *
 * All other parameters pass through transparently from client to Azure API.
 * Built with Express, includes CORS, rate limiting, and security best practices.
 * Supports Voice, Avatar, Agent Service (v1), and Foundry Agents (v2) with API key, MSAL, and Azure CLI auth.
 */

import express from "express";
import expressWs from "express-ws";
import cors from "cors";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { WebSocket } from "ws";
import dotenv from "dotenv";
import { parse } from "url";
import * as appInsights from "applicationinsights";
import { DefaultAzureCredential } from "@azure/identity";
import type {
  QueryParams,
  AzureConnectionConfig,
  ProxyConfig,
  SecurityConfig,
  Logger,
} from "./types.js";

dotenv.config();

// Initialize Application Insights if connection string is provided
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
  appInsights
    .setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
    .setAutoDependencyCorrelation(true)
    .setAutoCollectRequests(true)
    .setAutoCollectPerformance(true, true)
    .setAutoCollectExceptions(true)
    .setAutoCollectDependencies(true)
    .setAutoCollectConsole(true)
    .setUseDiskRetryCaching(true)
    .start();
}

// Create logger abstraction that works with or without Application Insights
const logger: Logger = {
  info: (message: string, properties?: Record<string, any>) => {
    console.log(message);
    if (appInsights.defaultClient) {
      appInsights.defaultClient.trackTrace({ message, properties });
    }
  },
  warn: (message: string, properties?: Record<string, any>) => {
    console.warn(message);
    if (appInsights.defaultClient) {
      appInsights.defaultClient.trackTrace({ message, properties });
    }
  },
  error: (message: string, error?: Error, properties?: Record<string, any>) => {
    console.error(message, error);
    if (appInsights.defaultClient) {
      if (error) {
        appInsights.defaultClient.trackException({
          exception: error,
          properties: { ...properties, message },
        });
      } else {
        appInsights.defaultClient.trackTrace({ message, properties });
      }
    }
  },
  trackEvent: (name: string, properties?: Record<string, any>) => {
    if (appInsights.defaultClient) {
      appInsights.defaultClient.trackEvent({ name, properties });
    }
  },
  trackMetric: (name: string, value: number, properties?: Record<string, any>) => {
    if (appInsights.defaultClient) {
      appInsights.defaultClient.trackMetric({ name, value, properties });
    }
  },
};

// Initialize Express with WebSocket support
const { app } = expressWs(express());

// Configuration - API key secured in backend (not exposed to browser)
const config: ProxyConfig = {
  port: parseInt(process.env.PORT || "8080", 10),
  apiVersion: process.env.API_VERSION || "2025-10-01",
  azureResourceName: process.env.FOUNDRY_RESOURCE_NAME || "",
  foundryApiKey: process.env.FOUNDRY_API_KEY,
  foundryAgentName: process.env.FOUNDRY_AGENT_NAME,
  foundryProjectName: process.env.FOUNDRY_PROJECT_NAME,
};

const securityConfig: SecurityConfig = {
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) || [
    "http://localhost:3000",
  ],
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10),
  maxConnections: parseInt(process.env.MAX_CONNECTIONS || "1000", 10),
};

if (!config.azureResourceName) {
  logger.error("Error: FOUNDRY_RESOURCE_NAME required in .env");
  process.exit(1);
}

// Track active connections
let activeConnections = 0;

// Entra ID credential for Foundry Agents server-side authentication
let credential: DefaultAzureCredential | null = null;

/**
 * Acquire Entra ID token using DefaultAzureCredential
 * Supports Azure CLI, managed identity, environment variables, and more.
 * Token caching and refresh is handled internally by the SDK.
 */
async function getEntraToken(): Promise<string> {
  if (!credential) {
    credential = new DefaultAzureCredential();
  }
  try {
    const response = await credential.getToken("https://ai.azure.com/.default");
    if (!response) {
      throw new Error("No token returned");
    }
    logger.info("[Auth] Entra ID token acquired", {
      expiresAt: new Date(response.expiresOnTimestamp).toISOString(),
    });
    return response.token;
  } catch (error) {
    throw new Error(
      `Entra ID token acquisition failed. Ensure Azure CLI is logged in (az login) ` +
      `or configure managed identity.\n` +
      `Original error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Security Middleware
 */

// Helmet for security headers
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) {
        return callback(null, true);
      }

      // Check if origin is in allowed list or if wildcard is set
      if (
        securityConfig.allowedOrigins.includes("*") ||
        securityConfig.allowedOrigins.some((allowed) => origin.startsWith(allowed))
      ) {
        callback(null, true);
      } else {
        logger.warn(`[Security] Blocked origin: ${origin}`, { origin });
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// Rate limiting per IP
const limiter = rateLimit({
  windowMs: securityConfig.rateLimitWindowMs,
  max: securityConfig.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again later.",
  handler: (req, res) => {
    logger.warn(`[Security] Rate limit exceeded for IP: ${req.ip}`, { ip: req.ip });
    res.status(429).json({
      error: "Too many requests",
      message: "Please try again later",
    });
  },
});

// Apply rate limiting to WebSocket endpoint
app.use("/ws", limiter);

// JSON parsing for HTTP endpoints
app.use(express.json());

/**
 * Build Azure WebSocket URL based on connection parameters
 *
 * Mode is automatically inferred from URL parameters (with .env fallback):
 * - Foundry Agents (v2): If agentName is present (URL or .env)
 * - Agent Service (v1): If agentId is present
 * - Standard mode: Otherwise (Voice/Avatar)
 *
 * Authentication methods:
 * - Foundry Agents: MSAL token from browser OR server-side DefaultAzureCredential
 * - Agent Service v1: MSAL token from browser (required)
 * - Standard mode: MSAL token from browser OR API key from backend
 */
async function buildAzureUrl(query: QueryParams): Promise<AzureConnectionConfig> {
  const apiVersion = query.apiVersion || config.apiVersion;
  const base = `wss://${config.azureResourceName}.services.ai.azure.com/voice-live/realtime?api-version=${apiVersion}`;

  // Resolve agentName/projectName: URL params take priority, .env as fallback
  const agentName = query.agentName || config.foundryAgentName;
  const projectName = query.projectName || config.foundryProjectName;

  // ===== Foundry Agents (v2): agentName-based =====
  if (agentName) {
    if (!projectName) {
      throw new Error("Foundry Agents requires both agentName and projectName (URL params or .env)");
    }

    logger.info("[Proxy] Mode: Foundry Agents (v2)", {
      agentName,
      projectName,
      source: query.agentName ? "url" : "env",
    });

    let agentUrl = `${base}&agent-name=${encodeURIComponent(agentName)}&agent-project-name=${encodeURIComponent(projectName)}`;

    if (query.conversationId) {
      agentUrl += `&conversation-id=${encodeURIComponent(query.conversationId)}`;
    }
    if (query.agentVersion) {
      agentUrl += `&agent-version=${encodeURIComponent(query.agentVersion)}`;
    }

    // Auth priority: browser MSAL token > server-side DefaultAzureCredential
    if (query.token) {
      logger.info("[Proxy] Auth: MSAL token (browser passthrough)");
      return {
        url: agentUrl,
        headers: { Authorization: `Bearer ${query.token}` },
      };
    }

    // Server-side: acquire token via DefaultAzureCredential (Azure CLI, managed identity, etc.)
    logger.info("[Proxy] Auth: DefaultAzureCredential (server-side)");
    const token = await getEntraToken();
    return {
      url: agentUrl,
      headers: { Authorization: `Bearer ${token}` },
    };
  }

  // ===== Agent Service (v1 classic): agentId-based =====
  if (query.agentId) {
    if (!query.projectName) {
      throw new Error("Agent Service v1 requires both agentId and projectName in URL");
    }
    if (!query.token) {
      throw new Error("Agent Service v1 requires token parameter (MSAL)");
    }

    logger.info("[Proxy] Mode: Agent Service (v1 classic)", {
      agentId: query.agentId,
      projectName: query.projectName,
    });

    const agentUrl = `${base}&agent-id=${query.agentId}&agent-project-name=${query.projectName}`;
    return {
      url: agentUrl,
      headers: { Authorization: `Bearer ${query.token}` },
    };
  }

  // ===== Standard mode: Voice/Avatar =====
  const model = query.model || "gpt-realtime";
  logger.info("[Proxy] Mode: Standard (Voice/Avatar)", { model });

  // Option 1: Token-based auth (MSAL from browser)
  if (query.token) {
    logger.info("[Proxy] Auth: MSAL token (user-level)");
    return {
      url: `${base}&model=${model}`,
      headers: { Authorization: `Bearer ${query.token}` },
    };
  }

  // Option 2: API key auth (from backend .env)
  if (config.foundryApiKey) {
    logger.info("[Proxy] Auth: API key (shared)");
    return {
      url: `${base}&model=${model}&api-key=${encodeURIComponent(config.foundryApiKey)}`,
      headers: {},
    };
  }

  throw new Error(
    "Standard mode requires either token parameter (MSAL) or FOUNDRY_API_KEY in .env"
  );
}

/**
 * Connect to Azure with appropriate authentication
 */
async function connectToAzure(query: QueryParams): Promise<WebSocket> {
  const { url, headers } = await buildAzureUrl(query);

  logger.info("[Proxy] Connecting to Azure...", {
    hasAuthHeader: !!headers.Authorization,
    headerCount: Object.keys(headers).length,
  });

  const azureWs = new WebSocket(url, { headers });

  return new Promise((resolve, reject) => {
    azureWs.once("open", () => {
      logger.info("[Proxy] Azure WebSocket opened successfully");
      resolve(azureWs);
    });
    azureWs.once("error", (error) => {
      logger.error("[Proxy] Azure WebSocket error during connection", error);
      reject(error);
    });
  });
}

/**
 * Health check endpoint
 */
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    activeConnections,
    maxConnections: securityConfig.maxConnections,
    timestamp: new Date().toISOString(),
  });
});

/**
 * WebSocket proxy endpoint for Microsoft Foundry Voice Live
 *
 * Mode is automatically inferred from URL parameters:
 *
 * Standard Mode (Voice/Avatar):
 * - With API key: ws://localhost:8080/ws?model=gpt-realtime
 * - With MSAL: ws://localhost:8080/ws?model=gpt-realtime&token=MSAL_TOKEN
 *
 * Foundry Agents (v2 - auto-detected when agentName present in URL or .env):
 * - Server auth: ws://localhost:8080/ws  (when FOUNDRY_AGENT_NAME + FOUNDRY_PROJECT_NAME in .env)
 * - URL params:  ws://localhost:8080/ws?agentName=MyAgent&projectName=myProject
 * - With MSAL:   ws://localhost:8080/ws?agentName=MyAgent&projectName=myProject&token=MSAL_TOKEN
 *
 * Agent Service (v1 classic - auto-detected when agentId present):
 * - With MSAL:  ws://localhost:8080/ws?agentId=xxx&projectName=yyy&token=MSAL_TOKEN
 */
app.ws("/ws", async (ws, req) => {
  // Check connection limit
  if (activeConnections >= securityConfig.maxConnections) {
    logger.warn("[Security] Max connections reached", {
      maxConnections: securityConfig.maxConnections,
    });
    ws.close(1008, "Server at capacity");
    return;
  }

  activeConnections++;
  logger.info(
    `\n[Proxy] Client connected (${activeConnections}/${securityConfig.maxConnections})`,
    { url: req.url, activeConnections }
  );
  logger.trackMetric("activeConnections", activeConnections);

  let azureWs: WebSocket | undefined;

  try {
    const parsed = parse(req.url || "", true);
    const query: QueryParams = parsed.query as QueryParams;

    azureWs = await connectToAzure(query);
    logger.info("[Proxy] Connected to Azure");

    // Determine mode for telemetry
    const agentName = query.agentName || config.foundryAgentName;
    const mode = agentName ? "foundry-agent" : query.agentId ? "agent-v1" : "standard";
    const model = query.model || "gpt-realtime";
    logger.trackEvent("WebSocketConnected", { mode, model, agentName });

    // Bidirectional message proxy
    ws.on("message", (msg) => {
      const text = msg.toString("utf8");
      try {
        const parsed = JSON.parse(text);

        // Skip logging audio buffer messages to reduce console spam
        if (parsed.type !== "input_audio_buffer.append") {
          logger.info(`[Proxy] Browser → Azure: ${parsed.type}`, {
            direction: "client-to-azure",
            messageType: parsed.type,
          });
        }
      } catch {
        logger.info("[Proxy] Browser → Azure: (non-JSON message)", {
          direction: "client-to-azure",
        });
      }

      if (azureWs?.readyState === WebSocket.OPEN) {
        azureWs.send(text);
      }
    });

    azureWs.on("message", (msg) => {
      const text = msg.toString("utf8");
      try {
        const parsed = JSON.parse(text);

        // Skip logging high-frequency messages to reduce console spam
        const skipTypes = ["response.audio.delta", "response.audio_transcript.delta"];
        if (!skipTypes.includes(parsed.type)) {
          logger.info(`[Proxy] Azure → Browser: ${parsed.type}`, {
            direction: "azure-to-client",
            messageType: parsed.type,
          });
        }
      } catch {
        logger.info("[Proxy] Azure → Browser: (non-JSON message)", {
          direction: "azure-to-client",
        });
      }

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(text);
      }
    });

    // Connection cleanup
    const cleanup = () => {
      activeConnections--;
      logger.info(
        `[Proxy] Client disconnected (${activeConnections}/${securityConfig.maxConnections})`,
        { activeConnections }
      );
      logger.trackMetric("activeConnections", activeConnections);
    };

    ws.on("close", () => {
      cleanup();
      azureWs?.close();
    });

    azureWs.on("close", (code, reason) => {
      logger.info(
        `[Proxy] Azure WebSocket closed - Code: ${code}, Reason: ${reason.toString() || "No reason"}`,
        {
          source: "azure",
          closeCode: code,
          closeReason: reason.toString(),
        }
      );
      ws.close();
    });

    ws.on("error", (error) => {
      logger.error("[Proxy] Client WebSocket error:", error, { source: "client" });
      cleanup();
    });

    azureWs.on("error", (error) => {
      logger.error("[Proxy] Azure WebSocket error:", error, { source: "azure" });
    });
  } catch (error) {
    activeConnections--;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("[Proxy] Error:", error instanceof Error ? error : undefined, { errorMessage });
    logger.trackEvent("WebSocketError", { errorMessage });
    ws.send(JSON.stringify({ type: "error", error: { message: errorMessage } }));
    ws.close();
    azureWs?.close();
  }
});

/**
 * Root endpoint - API info
 */
app.get("/", (_req, res) => {
  res.json({
    name: "@iloveagents/foundry-voice-live-proxy-node",
    version: "1.1.0",
    description: "Secure WebSocket proxy for Microsoft Foundry Voice Live API",
    endpoints: {
      health: "GET /health",
      websocket: "WS /ws",
    },
    documentation: "https://github.com/iLoveAgents/foundry-voice-live-proxy",
  });
});

/**
 * Start server
 */
app.listen(config.port, () => {
  const telemetryStatus = appInsights.defaultClient ? "enabled" : "disabled (console only)";

  logger.info("\nMicrosoft Foundry Voice Live Proxy Server");
  logger.info(`\nEndpoints:`);
  logger.info(`  HTTP:       http://localhost:${config.port}`);
  logger.info(`  WebSocket:  ws://localhost:${config.port}/ws`);
  logger.info(`  Health:     http://localhost:${config.port}/health`);
  logger.info(
    `\nMode Detection: Automatic (Foundry Agent if agentName, Agent v1 if agentId, otherwise Standard)`
  );
  if (config.foundryAgentName) {
    logger.info(`\nFoundry Agent: ${config.foundryAgentName} (project: ${config.foundryProjectName})`);
  }
  logger.info(`Foundry Agents: Supported (DefaultAzureCredential + MSAL passthrough)`);
  logger.info(`\nSecurity:`);
  logger.info(`  CORS:       ${securityConfig.allowedOrigins.length} allowed origin(s)`);
  logger.info(
    `  Rate Limit: ${securityConfig.rateLimitMax} req/${securityConfig.rateLimitWindowMs}ms per IP`
  );
  logger.info(`  Max Conns:  ${securityConfig.maxConnections} concurrent`);
  logger.info(`\nTelemetry:  ${telemetryStatus}\n`);

  logger.trackEvent("ServerStarted", {
    port: config.port,
    corsOrigins: securityConfig.allowedOrigins.length,
    rateLimit: securityConfig.rateLimitMax,
    maxConnections: securityConfig.maxConnections,
    telemetry: telemetryStatus,
  });
});
