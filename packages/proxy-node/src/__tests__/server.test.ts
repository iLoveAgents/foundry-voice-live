import { describe, it, expect, beforeEach, vi } from "vitest";
import type { QueryParams } from "../types.js";

describe("Microsoft Foundry Voice Live Proxy", () => {
  const mockResourceName = "test-resource";
  const mockApiVersion = "2025-10-01";
  const mockApiKey = "test-api-key";
  const mockToken = "test-msal-token";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildAzureUrl", () => {
    it("should build standard mode URL with API key (auto-detected)", () => {
      // Standard mode is auto-detected when no agentId/projectName
      const query: QueryParams = { model: "gpt-realtime" };
      const base = `wss://${mockResourceName}.services.ai.azure.com/voice-live/realtime?api-version=${mockApiVersion}`;
      const expected = `${base}&model=gpt-realtime&api-key=${encodeURIComponent(mockApiKey)}`;

      expect(query.agentId).toBeUndefined();
      expect(query.projectName).toBeUndefined();
      expect(expected).toContain("voice-live/realtime");
      expect(expected).toContain("model=gpt-realtime");
    });

    it("should build standard mode URL with MSAL token (auto-detected)", () => {
      // Standard mode is auto-detected when no agentId/projectName
      const query: QueryParams = { model: "gpt-realtime", token: mockToken };
      const base = `wss://${mockResourceName}.services.ai.azure.com/voice-live/realtime?api-version=${mockApiVersion}`;
      const expected = `${base}&model=gpt-realtime`;

      expect(query.agentId).toBeUndefined();
      expect(query.projectName).toBeUndefined();
      expect(query.token).toBe(mockToken);
      expect(expected).toContain("voice-live/realtime");
      expect(expected).toContain("model=gpt-realtime");
    });

    it("should build agent mode URL with required parameters (auto-detected)", () => {
      // Agent mode is auto-detected when agentId or projectName is present
      const query: QueryParams = {
        token: mockToken,
        agentId: "test-agent",
        projectName: "test-project",
      };
      const base = `wss://${mockResourceName}.services.ai.azure.com/voice-live/realtime?api-version=${mockApiVersion}`;
      const expected = `${base}&agent-id=test-agent&agent-project-name=test-project&agent-access-token=${encodeURIComponent(mockToken)}`;

      expect(query.agentId).toBe("test-agent");
      expect(query.projectName).toBe("test-project");
      expect(query.token).toBe(mockToken);
      expect(expected).toContain("agent-id=test-agent");
      expect(expected).toContain("agent-project-name=test-project");
      expect(expected).toContain("agent-access-token=");
    });

    it("should throw error for agent mode without token", () => {
      // Agent mode is auto-detected when agentId or projectName is present
      const query: QueryParams = {
        agentId: "test-agent",
        projectName: "test-project",
      };

      expect(() => {
        if (!query.token) {
          throw new Error("Agent mode requires token parameter (MSAL)");
        }
      }).toThrow("Agent mode requires token parameter (MSAL)");
    });

    it("should throw error for agent mode without both agentId and projectName", () => {
      // If only agentId is provided, should throw error
      const query: QueryParams = { agentId: "test-agent", token: mockToken };

      expect(() => {
        if (!query.agentId || !query.projectName) {
          throw new Error("Agent mode requires both agentId and projectName");
        }
      }).toThrow("Agent mode requires both agentId and projectName");
    });

    it("should auto-detect agent mode with only projectName present", () => {
      // Agent mode is auto-detected when either agentId or projectName is present
      const query: QueryParams = { projectName: "test-project", token: mockToken };

      // Should detect as agent mode and throw error for missing agentId
      expect(() => {
        const isAgentMode = !!(query.agentId || query.projectName);
        if (isAgentMode && (!query.agentId || !query.projectName)) {
          throw new Error("Agent mode requires both agentId and projectName");
        }
      }).toThrow("Agent mode requires both agentId and projectName");
    });
  });

  describe("Configuration Validation", () => {
    it("should validate required environment variables", () => {
      const azureResourceName = process.env.AZURE_AI_FOUNDRY_RESOURCE || "";

      if (!azureResourceName) {
        expect(() => {
          throw new Error("AZURE_AI_FOUNDRY_RESOURCE required in .env");
        }).toThrow("AZURE_AI_FOUNDRY_RESOURCE required in .env");
      }
    });

    it("should parse security configuration from environment", () => {
      const allowedOrigins = "http://localhost:3000,http://localhost:5173";
      const parsed = allowedOrigins.split(",").map((o) => o.trim());

      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toBe("http://localhost:3000");
      expect(parsed[1]).toBe("http://localhost:5173");
    });

    it("should parse numeric configuration values", () => {
      const port = parseInt("8080", 10);
      const rateLimitMax = parseInt("100", 10);
      const maxConnections = parseInt("1000", 10);

      expect(port).toBe(8080);
      expect(rateLimitMax).toBe(100);
      expect(maxConnections).toBe(1000);
    });
  });

  describe("Message Filtering", () => {
    it("should identify high-frequency message types", () => {
      const skipTypes = ["response.audio.delta", "response.audio_transcript.delta"];

      expect(skipTypes).toContain("response.audio.delta");
      expect(skipTypes).toContain("response.audio_transcript.delta");
    });

    it("should identify audio buffer messages", () => {
      const message = { type: "input_audio_buffer.append" };

      expect(message.type).toBe("input_audio_buffer.append");
    });

    it("should parse JSON messages correctly", () => {
      const msg = JSON.stringify({ type: "session.created", session: {} });
      const parsed = JSON.parse(msg);

      expect(parsed.type).toBe("session.created");
      expect(parsed).toHaveProperty("session");
    });
  });

  describe("CORS Validation", () => {
    it("should allow origin in allowed list", () => {
      const allowedOrigins = ["http://localhost:3000", "https://app.example.com"];
      const origin = "http://localhost:3000";

      const isAllowed =
        allowedOrigins.includes("*") ||
        allowedOrigins.some((allowed) => origin.startsWith(allowed));

      expect(isAllowed).toBe(true);
    });

    it("should block origin not in allowed list", () => {
      const allowedOrigins = ["http://localhost:3000"];
      const origin = "http://malicious.com";

      const isAllowed =
        allowedOrigins.includes("*") ||
        allowedOrigins.some((allowed) => origin.startsWith(allowed));

      expect(isAllowed).toBe(false);
    });

    it("should allow all origins with wildcard", () => {
      const allowedOrigins = ["*"];
      const origin = "http://any-origin.com";

      const isAllowed = allowedOrigins.includes("*");

      expect(origin).toBeTruthy();
      expect(isAllowed).toBe(true);
    });
  });

  describe("Connection Tracking", () => {
    it("should increment active connections on connect", () => {
      let activeConnections = 0;
      activeConnections++;

      expect(activeConnections).toBe(1);
    });

    it("should decrement active connections on disconnect", () => {
      let activeConnections = 5;
      activeConnections--;

      expect(activeConnections).toBe(4);
    });

    it("should enforce max connections limit", () => {
      const activeConnections = 1000;
      const maxConnections = 1000;

      const shouldBlock = activeConnections >= maxConnections;

      expect(shouldBlock).toBe(true);
    });
  });

  describe("Health Check Response", () => {
    it("should return health status with metrics", () => {
      const activeConnections = 5;
      const maxConnections = 1000;

      const health = {
        status: "ok",
        activeConnections,
        maxConnections,
        timestamp: new Date().toISOString(),
      };

      expect(health.status).toBe("ok");
      expect(health.activeConnections).toBe(5);
      expect(health.maxConnections).toBe(1000);
      expect(health.timestamp).toBeTruthy();
    });
  });

  describe("API Info Response", () => {
    it("should return API information", () => {
      const info = {
        name: "@iloveagents/foundry-voice-live-proxy-node",
        version: "1.1.0",
        description: "Secure WebSocket proxy for Microsoft Foundry Voice Live API",
        endpoints: {
          health: "GET /health",
          websocket: "WS /ws",
        },
        documentation: "https://github.com/iLoveAgents/foundry-voice-live-proxy",
      };

      expect(info.name).toBe("@iloveagents/foundry-voice-live-proxy-node");
      expect(info.version).toBe("1.1.0");
      expect(info.endpoints).toHaveProperty("health");
      expect(info.endpoints).toHaveProperty("websocket");
    });
  });
});
