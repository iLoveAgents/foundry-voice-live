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
import dotenv from "dotenv";
import { parse } from "url";
import * as appInsights from "applicationinsights";
import { DefaultAzureCredential } from "@azure/identity";
import {
  buildAzureUrl,
  DEFAULT_API_VERSION,
  isOriginAllowed,
  redactConnectionUrl,
  resolveAgentName,
} from "./connection.js";
import { relayWebSocket } from "./relay.js";
import type {
  QueryParams,
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
  apiVersion: process.env.API_VERSION || DEFAULT_API_VERSION,
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

  // Redact sensitive params (token, api-key) before logging
  const safeUrl = redactConnectionUrl(req.url || "");
  logger.info(
    `\n[Proxy] Client connected (${activeConnections}/${securityConfig.maxConnections})`,
    { url: safeUrl, activeConnections }
  );
  logger.trackMetric("activeConnections", activeConnections);

  const parsed = parse(req.url || "", true);
  const query = parsed.query as QueryParams;
  await relayWebSocket(ws, () => buildAzureUrl(query, config, getEntraToken), {
    onOpen: () => {
      logger.info("[Proxy] Connected to Azure");
      const agentName = resolveAgentName(query, config);
      const mode = agentName ? "foundry-agent" : query.agentId ? "agent-v1" : "standard";
      logger.trackEvent("WebSocketConnected", {
        mode,
        model: query.model || "gpt-realtime",
        agentName,
        transport: query.transport || "websocket",
      });
    },
    onClose: () => {
      activeConnections--;
      logger.info(`[Proxy] Client disconnected (${activeConnections}/${securityConfig.maxConnections})`);
      logger.trackMetric("activeConnections", activeConnections);
    },
    onError: (error) => {
      logger.error("[Proxy] WebSocket connection error", error);
      logger.trackEvent("WebSocketError", { errorMessage: error.message });
    },
    onMessage: (direction, text) => {
      try {
        const event = JSON.parse(text);
        const skipTypes = ["input_audio_buffer.append", "response.audio.delta", "response.audio_transcript.delta"];
        if (!skipTypes.includes(event.type)) {
          logger.info(`[Proxy] ${direction}: ${event.type}`, { direction, messageType: event.type });
        }
      } catch {
        logger.info(`[Proxy] ${direction}: (non-JSON message)`, { direction });
      }
    },
  });
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
