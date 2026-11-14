import { describe, it, expect, vi } from "vitest";
import {
  buildAzureUrl,
  DEFAULT_API_VERSION,
  isOriginAllowed,
  redactConnectionUrl,
} from "../connection.js";
import type { ProxyConfig, QueryParams } from "../types.js";

const config: ProxyConfig = {
  port: 8080,
  apiVersion: DEFAULT_API_VERSION,
  azureResourceName: "test-resource",
  foundryApiKey: "server-secret",
};

function credential(): ReturnType<typeof vi.fn<() => Promise<string>>> {
  return vi.fn<() => Promise<string>>().mockResolvedValue("server-token");
}

describe("Voice Live service connection", () => {
  it("routes WebRTC signaling to calls with the realtime subprotocol and server authentication", async () => {
    const result = await buildAzureUrl(
      { transport: "webrtc", model: "azure-realtime", features: "client_ec_reference:true" },
      config,
      credential()
    );
    const url = new URL(result.url);
    expect(url.pathname).toBe("/voice-live/realtime/calls");
    expect(url.searchParams.get("api-version")).toBe("2026-07-15");
    expect(url.searchParams.get("model")).toBe("azure-realtime");
    expect(url.searchParams.get("features")).toBe("client_ec_reference:true");
    expect(url.searchParams.has("transport")).toBe(false);
    expect(result.protocols).toEqual(["realtime"]);
    expect(result.headers).toEqual({ "api-key": "server-secret" });
  });

  it("keeps explicit WebSocket connections on the original endpoint", async () => {
    const result = await buildAzureUrl({ transport: "websocket" }, config, credential());
    expect(new URL(result.url).pathname).toBe("/voice-live/realtime");
    expect(result.protocols).toBeUndefined();
  });

  it("preserves agent routing and Entra auth for WebRTC control", async () => {
    const result = await buildAzureUrl(
      { transport: "webrtc", agentName: "agent", projectName: "project", token: "caller-token" },
      config,
      credential()
    );
    const url = new URL(result.url);
    expect(url.pathname).toBe("/voice-live/realtime/calls");
    expect(url.searchParams.get("agent-name")).toBe("agent");
    expect(url.searchParams.get("agent-project-name")).toBe("project");
    expect(result.headers).toEqual({ Authorization: "Bearer caller-token" });
  });

  it("rejects unsupported transports before acquiring credentials", async () => {
    const getToken = credential();
    await expect(
      buildAzureUrl({ transport: "http" } as unknown as QueryParams, config, getToken)
    ).rejects.toThrow("Unsupported transport");
    expect(getToken).not.toHaveBeenCalled();
  });

  it("uses the GA API and keeps API keys in headers, not URLs", async () => {
    const getToken = credential();
    const result = await buildAzureUrl({}, config, getToken);
    const url = new URL(result.url);
    expect(url.origin).toBe("wss://test-resource.services.ai.azure.com");
    expect(url.pathname).toBe("/voice-live/realtime");
    expect(url.searchParams.get("api-version")).toBe("2026-07-15");
    expect(url.searchParams.get("model")).toBe("gpt-realtime");
    expect(result.headers).toEqual({ "api-key": "server-secret" });
    expect(result.url).not.toContain("server-secret");
    expect(getToken).not.toHaveBeenCalled();
  });

  it("prioritizes caller Entra credentials over a configured API key", async () => {
    const getToken = credential();
    const result = await buildAzureUrl({ token: "user-token" }, config, getToken);
    expect(result.headers).toEqual({ Authorization: "Bearer user-token" });
    expect(result.url).not.toContain("user-token");
    expect(getToken).not.toHaveBeenCalled();
  });

  it("uses server-side Entra authentication for keyless standard sessions", async () => {
    const getToken = credential();
    const result = await buildAzureUrl({}, { ...config, foundryApiKey: undefined }, getToken);
    expect(getToken).toHaveBeenCalledOnce();
    expect(result.headers.Authorization).toBe("Bearer server-token");
  });

  it("preserves feature flags and BYOM routing without permitting parameter injection", async () => {
    const result = await buildAzureUrl(
      {
        model: "deployment&api-key=injected",
        apiVersion: "2026-06-01-preview",
        profile: "byom-foundry-openai-responses",
        foundryResourceOverride: "model-resource",
        features: "client_ec_reference:true",
      },
      config,
      credential()
    );
    const query = new URL(result.url).searchParams;
    expect(query.get("model")).toBe("deployment&api-key=injected");
    expect(query.has("api-key")).toBe(false);
    expect(query.get("api-version")).toBe("2026-06-01-preview");
    expect(query.get("profile")).toBe("byom-foundry-openai-responses");
    expect(query.get("foundry-resource-override")).toBe("model-resource");
    expect(query.get("features")).toBe("client_ec_reference:true");
  });

  it("connects a Foundry agent with version, conversation, and cross-resource identity", async () => {
    const getToken = credential();
    const result = await buildAzureUrl(
      {
        agentName: "My Agent",
        projectName: "project&name",
        agentVersion: "4",
        conversationId: "conv_123",
        foundryResourceOverride: "agent-resource",
        authenticationIdentityClientId: "identity-id",
      },
      config,
      getToken
    );
    const query = new URL(result.url).searchParams;
    expect(Object.fromEntries(query)).toEqual({
      "api-version": "2026-07-15",
      "foundry-resource-override": "agent-resource",
      "agent-name": "My Agent",
      "agent-project-name": "project&name",
      "agent-version": "4",
      "conversation-id": "conv_123",
      "agent-authentication-identity-client-id": "identity-id",
    });
    expect(result.headers).toEqual({ Authorization: "Bearer server-token" });
    expect(getToken).toHaveBeenCalledOnce();
  });

  it("uses caller credentials for Foundry agents without acquiring a server token", async () => {
    const getToken = credential();
    const result = await buildAzureUrl(
      { agentName: "agent", projectName: "project", token: "user-token" },
      config,
      getToken
    );
    expect(result.headers.Authorization).toBe("Bearer user-token");
    expect(getToken).not.toHaveBeenCalled();
  });

  it("uses configured default agents only when neither model nor classic agent is selected", async () => {
    const defaults = {
      ...config,
      foundryAgentName: "default-agent",
      foundryProjectName: "default-project",
    };
    const inherited = await buildAzureUrl({}, defaults, credential());
    expect(new URL(inherited.url).searchParams.get("agent-name")).toBe("default-agent");
    const standard = await buildAzureUrl({ model: "azure-realtime" }, defaults, credential());
    expect(new URL(standard.url).searchParams.has("agent-name")).toBe(false);
    const classic = await buildAzureUrl(
      { agentId: "asst_1", projectName: "classic", token: "classic-token" },
      defaults,
      credential()
    );
    expect(new URL(classic.url).searchParams.has("agent-name")).toBe(false);
    expect(new URL(classic.url).searchParams.get("agent-id")).toBe("asst_1");
  });

  it("forwards the classic agent token separately from the Voice Live handshake", async () => {
    const result = await buildAzureUrl(
      {
        agentId: "asst_1",
        projectName: "classic",
        agentAccessToken: "agent-token",
        token: "voice-token",
      },
      config,
      credential()
    );
    expect(new URL(result.url).searchParams.get("agent-access-token")).toBe("agent-token");
    expect(result.headers.Authorization).toBe("Bearer voice-token");
  });

  it("supports API-key Voice Live authentication with a separate classic agent token", async () => {
    const result = await buildAzureUrl(
      { agentId: "asst_1", projectName: "classic", agentAccessToken: "agent-token" },
      config,
      credential()
    );
    expect(new URL(result.url).searchParams.get("agent-access-token")).toBe("agent-token");
    expect(result.headers).toEqual({ "api-key": "server-secret" });
  });

  it("retains the single-token classic connection shorthand", async () => {
    const result = await buildAzureUrl(
      { agentId: "asst_1", projectName: "classic", token: "user-token" },
      config,
      credential()
    );
    expect(new URL(result.url).searchParams.get("agent-access-token")).toBe("user-token");
    expect(result.headers.Authorization).toBe("Bearer user-token");
  });

  it.each([
    [{ agentName: "agent" }, "projectName"],
    [{ agentId: "asst_1", token: "token" }, "projectName"],
    [{ agentId: "asst_1", projectName: "project" }, "token"],
  ])("rejects incomplete agent configuration %o", async (query, message) => {
    const getToken = credential();
    await expect(buildAzureUrl(query, config, getToken)).rejects.toThrow(message);
    expect(getToken).not.toHaveBeenCalled();
  });

  it("rejects repeated query parameters instead of coercing arrays", async () => {
    const query = { token: ["first", "second"] } as unknown as QueryParams;
    await expect(buildAzureUrl(query, config, credential())).rejects.toThrow("single string value");
  });

  it("propagates credential acquisition failures", async () => {
    const getToken = vi.fn().mockRejectedValue(new Error("credential unavailable"));
    await expect(
      buildAzureUrl({ agentName: "agent", projectName: "project" }, config, getToken)
    ).rejects.toThrow("credential unavailable");
  });
});

describe("connection logging and origins", () => {
  it("redacts every supported secret, including repeated and encoded names", () => {
    const sanitized = redactConnectionUrl(
      "/ws?model=azure-realtime&token=secret1&token=secret2&%41uthorization=secret3&agentAccessToken=secret4&api-key=secret5&agent-access-token=secret6"
    );
    expect(sanitized).not.toContain("secret");
    expect(sanitized).toContain("model=azure-realtime");
    expect(sanitized).toContain("REDACTED");
  });

  it("matches allowed origins exactly", () => {
    const allowed = ["https://app.example.com"];
    expect(isOriginAllowed("https://app.example.com", allowed)).toBe(true);
    expect(isOriginAllowed("https://app.example.com.attacker.test", allowed)).toBe(false);
    expect(isOriginAllowed("https://app.example.com:444", allowed)).toBe(false);
    expect(isOriginAllowed("https://other.example.com", ["*"])).toBe(true);
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
  });
});
