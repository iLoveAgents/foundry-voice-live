#!/usr/bin/env node

/**
 * Microsoft Foundry Voice Live Proxy Server
 *
 * Transparent WebSocket proxy for Microsoft Foundry Voice Live API with two main responsibilities:
 * 1. Move the browser's token from the URL to the Authorization header (browser WebSocket limitation)
 * 2. Keep credentials on the server (API key or DefaultAzureCredential, never exposed to the browser)
 *
 * All other parameters pass through transparently from client to Azure API.
 * Built with Express, includes CORS, rate limiting, and security best practices.
 * Supports Voice, Avatar, and Foundry Agents with browser token passthrough, API key, and
 * DefaultAzureCredential auth, over the WebSocket or WebRTC (preview) transport.
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
  ProxyConfig,
  ProxyMode,
  SecurityConfig,
  Logger,
  Transport,
} from "./types.js";
import {
  buildAzureUrl,
  redactUrl,
  resolveAgent,
  resolveApiVersion,
  DEFAULT_MODEL,
  ENTRA_SCOPE,
  ProxyRequestError,
} from "./url.js";
import { readPackageInfo } from "./packageInfo.js";
import { PendingMessageQueue } from "./pendingQueue.js";
import { isOriginAllowed } from "./security.js";

dotenv.config();

const packageInfo = readPackageInfo();
const REPOSITORY_URL = "https://github.com/iLoveAgents/foundry-voice-live";

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
  // undefined = built-in default per transport (see url.ts); can be overridden per connection via ?apiVersion=
  apiVersion: process.env.API_VERSION || undefined,
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

// Entra ID credential for server-side authentication (Foundry Agents, or keyless standard mode)
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
    const response = await credential.getToken(ENTRA_SCOPE);
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

      // Exact match — a prefix check would let http://localhost:3001.attacker.com through
      if (isOriginAllowed(origin, securityConfig.allowedOrigins)) {
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

const MODE_LABELS = {
  "foundry-agent": "Foundry Agents",
  standard: "Standard (Voice/Avatar)",
} as const;

const AUTH_LABELS = {
  "msal-token": "Bearer token (browser passthrough)",
  "api-key": "API key (server-side, shared)",
  "entra-credential": "DefaultAzureCredential (server-side)",
} as const;

/** How long the upstream Voice Live WebSocket handshake may take before it is aborted */
const UPSTREAM_HANDSHAKE_TIMEOUT_MS = 15000;

/**
 * Result of `connectToAzure`: the open upstream socket plus what was resolved (for telemetry)
 */
interface AzureConnection {
  azureWs: WebSocket;
  mode: ProxyMode;
  transport: Transport;
  /** Resolved agent name (agent mode only) */
  agentName?: string;
  /** Model (standard mode only) */
  model?: string;
}

/**
 * Connect to Azure with appropriate authentication
 *
 * URL/mode/auth resolution lives in `url.ts` (pure, unit-tested); this function only
 * adds logging and opens the upstream WebSocket.
 */
async function connectToAzure(query: QueryParams): Promise<AzureConnection> {
  const { url, headers, mode, authMethod, transport } = await buildAzureUrl(query, config, {
    getEntraToken,
  });

  const { agentName, projectName, source } = resolveAgent(query, config);
  const model = mode === "standard" ? query.model || DEFAULT_MODEL : undefined;
  logger.info(`[Proxy] Mode: ${MODE_LABELS[mode]}`, {
    mode,
    transport,
    ...(mode === "foundry-agent" ? { agentName, projectName, source } : { model }),
  });
  logger.info(`[Proxy] Auth: ${AUTH_LABELS[authMethod]}`, { authMethod });
  logger.info(`[Proxy] Connecting to Azure (${transport}): ${redactUrl(url)}`, {
    url: redactUrl(url),
    transport,
    hasAuthHeader: !!headers.Authorization,
    headerCount: Object.keys(headers).length,
  });

  // handshakeTimeout: an upstream that accepts the TCP connection but never completes the
  // WebSocket handshake would otherwise hold the client socket and a connection slot forever
  const azureWs = new WebSocket(url, { headers, handshakeTimeout: UPSTREAM_HANDSHAKE_TIMEOUT_MS });

  return new Promise((resolve, reject) => {
    azureWs.once("open", () => {
      logger.info("[Proxy] Azure WebSocket opened successfully");
      resolve({ azureWs, mode, transport, agentName, model });
    });
    azureWs.once("error", (error) => {
      logger.error("[Proxy] Azure WebSocket error during connection", error);
      reject(error);
    });
  });
}

/**
 * Cheap event-type extraction for relay logging. Avoids a full `JSON.parse` of every
 * frame (audio deltas are large and high-frequency); only the leading `"type"` member is read.
 */
const EVENT_TYPE_PATTERN = /"type"\s*:\s*"([^"\\]{1,128})"/;
function extractEventType(text: string): string | undefined {
  // The `type` member is at the top of every Voice Live event; cap the scan for safety
  return EVENT_TYPE_PATTERN.exec(text.slice(0, 512))?.[1];
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
 * - With API key:   ws://localhost:8080/ws?model=gpt-realtime  (FOUNDRY_API_KEY in .env)
 * - With token:     ws://localhost:8080/ws?model=gpt-realtime&token=MSAL_TOKEN
 * - Keyless:        ws://localhost:8080/ws?model=gpt-realtime  (no key, no token → DefaultAzureCredential)
 *
 * Foundry Agents (auto-detected when agentName present in URL or .env):
 * - Server auth: ws://localhost:8080/ws  (when FOUNDRY_AGENT_NAME + FOUNDRY_PROJECT_NAME in .env)
 * - URL params:  ws://localhost:8080/ws?agentName=MyAgent&projectName=myProject
 * - With token:  ws://localhost:8080/ws?agentName=MyAgent&projectName=myProject&token=MSAL_TOKEN
 *
 * Transport (both modes):
 * - WebSocket (default): audio + events over this socket
 * - WebRTC (preview):    ws://localhost:8080/ws?...&transport=webrtc — this socket becomes the
 *                        WebRTC control channel (upstream /voice-live/realtime/calls); media flows
 *                        directly between the browser and Azure.
 *
 * Optional: &apiVersion=YYYY-MM-DD[-preview] overrides API_VERSION / the built-in default.
 */
app.ws("/ws", async (ws, req) => {
  // The upgrade completes before the CORS middleware can reject it, so check here too
  const origin = req.headers.origin;
  if (!isOriginAllowed(origin, securityConfig.allowedOrigins)) {
    logger.warn(`[Security] Blocked WebSocket origin: ${origin}`, { origin });
    ws.close(1008, "Origin not allowed");
    return;
  }

  // Check connection limit
  if (activeConnections >= securityConfig.maxConnections) {
    logger.warn("[Security] Max connections reached", {
      maxConnections: securityConfig.maxConnections,
    });
    ws.close(1008, "Server at capacity");
    return;
  }

  activeConnections++;

  // Redact sensitive params (token, api-key, Authorization) before logging
  const safeUrl = redactUrl(req.url || "");
  logger.info(
    `\n[Proxy] Client connected (${activeConnections}/${securityConfig.maxConnections})`,
    { url: safeUrl, activeConnections }
  );
  logger.trackMetric("activeConnections", activeConnections);

  let azureWs: WebSocket | undefined;
  let clientClosed = false;

  // Connection cleanup — guarded so close + error on the same socket only count once
  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    activeConnections--;
    logger.info(
      `[Proxy] Client disconnected (${activeConnections}/${securityConfig.maxConnections})`,
      { activeConnections }
    );
    logger.trackMetric("activeConnections", activeConnections);
  };

  // Register client lifecycle handlers immediately: the browser may disconnect while the
  // upstream connect (token acquisition + WebSocket handshake) is still in flight.
  ws.on("close", () => {
    clientClosed = true;
    cleanup();
    azureWs?.close();
  });
  ws.on("error", (error) => {
    logger.error("[Proxy] Client WebSocket error:", error, { source: "client" });
    clientClosed = true;
    cleanup();
    azureWs?.close();
  });

  // Messages the browser sends before the upstream socket is open are queued and flushed
  // once Azure is connected. Clients such as the WebRTC transport send `rtc.call.sdp.create`
  // immediately on open — dropping it would leave the negotiation hanging.
  const pendingMessages = new PendingMessageQueue();

  const forwardToAzure = (text: string): void => {
    const type = extractEventType(text);
    // Skip logging audio buffer messages to reduce console spam
    if (type !== "input_audio_buffer.append") {
      logger.info(`[Proxy] Browser → Azure: ${type ?? "(unknown type)"}`, {
        direction: "client-to-azure",
        messageType: type,
      });
    }
    azureWs?.send(text);
  };

  // Register the browser → Azure relay immediately (before the upstream connect completes)
  ws.on("message", (msg) => {
    const text = msg.toString("utf8");
    if (azureWs?.readyState === WebSocket.OPEN) {
      forwardToAzure(text);
      return;
    }
    const queued = pendingMessages.push(text);
    if (queued === "over-budget") {
      logger.warn("[Proxy] Closing client: queued pre-connect payload exceeds the byte budget", {
        pendingBytes: pendingMessages.byteLength,
        frameLength: text.length,
        maxPendingBytes: pendingMessages.maxBytes,
      });
      ws.close(1009, "Queued payload too large before upstream connect");
    } else if (queued === "dropped") {
      logger.warn("[Proxy] Dropping browser message: upstream not connected and queue full");
    }
  });

  try {
    const parsed = parse(req.url || "", true);
    const query: QueryParams = parsed.query as QueryParams;

    const connection = await connectToAzure(query);
    azureWs = connection.azureWs;

    if (clientClosed) {
      // Browser went away while we were connecting upstream
      logger.info("[Proxy] Client disconnected during upstream connect — closing Azure socket");
      azureWs.close();
      return;
    }
    logger.info("[Proxy] Connected to Azure");

    logger.trackEvent("WebSocketConnected", {
      mode: connection.mode,
      transport: connection.transport,
      model: connection.model,
      agentName: connection.agentName,
    });

    // Flush anything the browser sent while we were connecting upstream
    if (pendingMessages.size > 0) {
      logger.info(`[Proxy] Flushing ${pendingMessages.size} queued browser message(s)`);
      for (const text of pendingMessages.drain()) {
        forwardToAzure(text);
      }
    }

    // Skip logging high-frequency messages to reduce console spam
    const SKIP_LOG_TYPES = new Set(["response.audio.delta", "response.audio_transcript.delta"]);

    azureWs.on("message", (msg) => {
      const text = msg.toString("utf8");
      const type = extractEventType(text);
      if (type === undefined || !SKIP_LOG_TYPES.has(type)) {
        logger.info(`[Proxy] Azure → Browser: ${type ?? "(unknown type)"}`, {
          direction: "azure-to-client",
          messageType: type,
        });
      }

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(text);
      }
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

    azureWs.on("error", (error) => {
      logger.error("[Proxy] Azure WebSocket error:", error, { source: "azure" });
      // Don't rely on `ws` always emitting a paired "close": tell the browser explicitly, so the
      // SDK sees an unclean close and can reconnect
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, "Upstream error");
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("[Proxy] Error:", error instanceof Error ? error : undefined, { errorMessage });
    logger.trackEvent("WebSocketError", { errorMessage });
    if (ws.readyState === WebSocket.OPEN) {
      // Only surface errors about the client's own request. Everything else (token acquisition,
      // upstream handshake, DNS) can carry server-side detail the browser has no business seeing.
      const clientMessage =
        error instanceof ProxyRequestError ? error.message : "Upstream connection failed";
      ws.send(JSON.stringify({ type: "error", error: { message: clientMessage } }));
    }
    ws.close();
    azureWs?.close();
    // `ws.close()` fires the close handler → cleanup(); cover sockets that never opened
    cleanup();
  }
});

/**
 * Root endpoint - API info
 */
app.get("/", (_req, res) => {
  res.json({
    name: packageInfo.name,
    version: packageInfo.version,
    description: "Secure WebSocket proxy for Microsoft Foundry Voice Live API",
    endpoints: {
      health: "GET /health",
      websocket: "WS /ws",
    },
    websocketParams: {
      model: "Model for standard mode (default: gpt-realtime)",
      token: "Bearer token from the browser (moved to the Authorization header)",
      agentName: "Foundry Agent name (enables agent mode; .env fallback FOUNDRY_AGENT_NAME)",
      projectName: "Foundry project name (with agentName; .env fallback FOUNDRY_PROJECT_NAME)",
      conversationId: "Resume a previous conversation (agent mode)",
      agentVersion: "Pin an agent version (agent mode)",
      agentAuthenticationIdentityClientId:
        "Managed identity client ID for agent authentication (agent mode)",
      foundryResourceOverride: "Foundry resource override (agent mode)",
      transport: "websocket (default) or webrtc (preview, WebRTC control channel)",
      apiVersion: "Override the API version for this connection",
    },
    apiVersion: {
      websocket: resolveApiVersion({}, config, "websocket"),
      webrtc: resolveApiVersion({}, config, "webrtc"),
    },
    documentation: REPOSITORY_URL,
  });
});

/**
 * Start server
 */
app.listen(config.port, () => {
  const telemetryStatus = appInsights.defaultClient ? "enabled" : "disabled (console only)";
  const websocketApiVersion = resolveApiVersion({}, config, "websocket");
  const webrtcApiVersion = resolveApiVersion({}, config, "webrtc");
  const apiVersionSource = config.apiVersion ? "from API_VERSION" : "built-in default";

  logger.info(`\nMicrosoft Foundry Voice Live Proxy Server v${packageInfo.version}`);
  logger.info(`\nEndpoints:`);
  logger.info(`  HTTP:       http://localhost:${config.port}`);
  logger.info(`  WebSocket:  ws://localhost:${config.port}/ws`);
  logger.info(`  Health:     http://localhost:${config.port}/health`);
  logger.info(`\nUpstream:`);
  logger.info(`  Resource:    ${config.azureResourceName}.services.ai.azure.com`);
  logger.info(
    `  API Version: ${websocketApiVersion} (${apiVersionSource}; override per connection with ?apiVersion=)`
  );
  logger.info(
    `  WebRTC:      ?transport=webrtc → /voice-live/realtime/calls (api-version ${webrtcApiVersion}, preview)`
  );
  logger.info(
    `\nMode Detection: Automatic (Foundry Agent if agentName in URL or .env, otherwise Standard)`
  );
  if (config.foundryAgentName) {
    logger.info(
      `Foundry Agent (.env default): ${config.foundryAgentName} (project: ${config.foundryProjectName})`
    );
  }
  logger.info(
    `Auth: browser token > ${config.foundryApiKey ? "FOUNDRY_API_KEY (set, standard mode)" : "FOUNDRY_API_KEY (not set)"} > DefaultAzureCredential`
  );
  logger.info(`\nSecurity:`);
  logger.info(`  CORS:       ${securityConfig.allowedOrigins.length} allowed origin(s)`);
  logger.info(
    `  Rate Limit: ${securityConfig.rateLimitMax} req/${securityConfig.rateLimitWindowMs}ms per IP`
  );
  logger.info(`  Max Conns:  ${securityConfig.maxConnections} concurrent`);
  logger.info(`\nTelemetry:  ${telemetryStatus}\n`);

  logger.trackEvent("ServerStarted", {
    version: packageInfo.version,
    port: config.port,
    apiVersion: websocketApiVersion,
    webrtcApiVersion,
    corsOrigins: securityConfig.allowedOrigins.length,
    rateLimit: securityConfig.rateLimitMax,
    maxConnections: securityConfig.maxConnections,
    telemetry: telemetryStatus,
  });
});
