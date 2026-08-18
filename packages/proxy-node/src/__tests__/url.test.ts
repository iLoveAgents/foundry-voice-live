import { describe, it, expect, vi } from "vitest";
import {
  buildAzureUrl,
  redactUrl,
  resolveAgent,
  resolveApiVersion,
  resolveMode,
  resolveTransport,
  DEFAULT_API_VERSION,
  DEFAULT_MODEL,
  DEFAULT_WEBRTC_API_VERSION,
  ENTRA_SCOPE,
  type UrlBuildConfig,
  type UrlBuildDeps,
} from "../url.js";
import type { QueryParams } from "../types.js";

const RESOURCE = "test-resource";
const ORIGIN = `wss://${RESOURCE}.services.ai.azure.com`;
const REALTIME_PATH = "/voice-live/realtime";
const REALTIME_CALLS_PATH = "/voice-live/realtime/calls";
const API_KEY = "test-api-key";
const BROWSER_TOKEN = "browser-msal-token";
const ENTRA_TOKEN = "server-entra-token";

function cfg(overrides: Partial<UrlBuildConfig> = {}): UrlBuildConfig {
  return { azureResourceName: RESOURCE, ...overrides };
}

function deps(
  token: string = ENTRA_TOKEN
): UrlBuildDeps & { getEntraToken: ReturnType<typeof vi.fn> } {
  return { getEntraToken: vi.fn().mockResolvedValue(token) };
}

/** Parse the upstream URL into origin, pathname and decoded query params */
function parseUrl(url: string): { origin: string; pathname: string; params: URLSearchParams } {
  const parsed = new URL(url);
  return {
    origin: `${parsed.protocol}//${parsed.host}`,
    pathname: parsed.pathname,
    params: parsed.searchParams,
  };
}

describe("constants", () => {
  it("exposes the GA default API version", () => {
    expect(DEFAULT_API_VERSION).toBe("2026-07-15");
  });

  it("exposes the WebRTC (preview) default API version", () => {
    expect(DEFAULT_WEBRTC_API_VERSION).toBe("2026-01-01-preview");
  });

  it("exposes the default model and Entra scope", () => {
    expect(DEFAULT_MODEL).toBe("gpt-realtime");
    expect(ENTRA_SCOPE).toBe("https://ai.azure.com/.default");
  });
});

describe("resolveTransport", () => {
  it("defaults to websocket when the transport param is absent or empty", () => {
    expect(resolveTransport({})).toBe("websocket");
    expect(resolveTransport({ transport: "" })).toBe("websocket");
    expect(resolveTransport({ transport: "websocket" })).toBe("websocket");
  });

  it("returns webrtc for transport=webrtc (case-insensitive)", () => {
    expect(resolveTransport({ transport: "webrtc" })).toBe("webrtc");
    expect(resolveTransport({ transport: "WebRTC" })).toBe("webrtc");
  });

  it("throws for unknown transport values", () => {
    expect(() => resolveTransport({ transport: "ws" })).toThrow(/Unsupported transport 'ws'/);
  });
});

describe("resolveMode / resolveAgent", () => {
  it("is standard when no agent name is available", () => {
    expect(resolveMode({}, cfg())).toBe("standard");
    expect(resolveMode({ model: "gpt-realtime" }, cfg())).toBe("standard");
    expect(resolveAgent({}, cfg())).toEqual({});
  });

  it("is agent mode when agentName is passed in the URL", () => {
    const query: QueryParams = { agentName: "MyAgent", projectName: "my-project" };
    expect(resolveMode(query, cfg())).toBe("foundry-agent");
    expect(resolveAgent(query, cfg())).toEqual({
      agentName: "MyAgent",
      projectName: "my-project",
      source: "url",
    });
  });

  it("falls back to .env agent/project only when the model param is absent", () => {
    const envCfg = cfg({ foundryAgentName: "EnvAgent", foundryProjectName: "env-project" });

    expect(resolveMode({}, envCfg)).toBe("foundry-agent");
    expect(resolveAgent({}, envCfg)).toEqual({
      agentName: "EnvAgent",
      projectName: "env-project",
      source: "env",
    });

    // model present → standard Voice/Avatar request, .env agent ignored
    expect(resolveMode({ model: "gpt-realtime" }, envCfg)).toBe("standard");
    expect(resolveAgent({ model: "gpt-realtime" }, envCfg)).toEqual({});
  });

  it("lets URL params override .env values individually", () => {
    const envCfg = cfg({ foundryAgentName: "EnvAgent", foundryProjectName: "env-project" });
    expect(resolveAgent({ agentName: "UrlAgent" }, envCfg)).toEqual({
      agentName: "UrlAgent",
      projectName: "env-project",
      source: "url",
    });
  });
});

describe("resolveApiVersion", () => {
  it("uses the built-in default per transport when nothing is configured", () => {
    expect(resolveApiVersion({}, cfg(), "websocket")).toBe(DEFAULT_API_VERSION);
    expect(resolveApiVersion({}, cfg(), "webrtc")).toBe(DEFAULT_WEBRTC_API_VERSION);
  });

  it("prefers API_VERSION (config) over the built-in default", () => {
    expect(resolveApiVersion({}, cfg({ apiVersion: "2025-10-01" }), "websocket")).toBe(
      "2025-10-01"
    );
    expect(resolveApiVersion({}, cfg({ apiVersion: "2025-10-01" }), "webrtc")).toBe("2025-10-01");
  });

  it("prefers ?apiVersion= over API_VERSION and the default", () => {
    const query: QueryParams = { apiVersion: "2026-01-01-preview" };
    expect(resolveApiVersion(query, cfg({ apiVersion: "2025-10-01" }), "websocket")).toBe(
      "2026-01-01-preview"
    );
    expect(resolveApiVersion(query, cfg(), "webrtc")).toBe("2026-01-01-preview");
  });

  it("treats empty strings as unset", () => {
    expect(resolveApiVersion({ apiVersion: "" }, cfg({ apiVersion: "" }), "websocket")).toBe(
      DEFAULT_API_VERSION
    );
  });
});

describe("buildAzureUrl - standard mode", () => {
  it("uses the API key from config in the URL (no headers)", async () => {
    const d = deps();
    const result = await buildAzureUrl(
      { model: "gpt-realtime" },
      cfg({ foundryApiKey: API_KEY }),
      d
    );
    const { origin, pathname, params } = parseUrl(result.url);

    expect(origin).toBe(ORIGIN);
    expect(pathname).toBe(REALTIME_PATH);
    expect(params.get("api-version")).toBe(DEFAULT_API_VERSION);
    expect(params.get("model")).toBe("gpt-realtime");
    expect(params.get("api-key")).toBe(API_KEY);
    expect(params.has("agent-name")).toBe(false);
    expect(result.headers).toEqual({});
    expect(result.mode).toBe("standard");
    expect(result.authMethod).toBe("api-key");
    expect(result.transport).toBe("websocket");
    expect(d.getEntraToken).not.toHaveBeenCalled();
  });

  it("URL-encodes the API key and model", async () => {
    const result = await buildAzureUrl(
      { model: "gpt-4o realtime/preview" },
      cfg({ foundryApiKey: "key with/special&chars=" }),
      deps()
    );
    expect(result.url).toContain("api-key=key%20with%2Fspecial%26chars%3D");
    expect(result.url).toContain("model=gpt-4o%20realtime%2Fpreview");
    expect(parseUrl(result.url).params.get("api-key")).toBe("key with/special&chars=");
  });

  it("defaults the model to gpt-realtime", async () => {
    const result = await buildAzureUrl({}, cfg({ foundryApiKey: API_KEY }), deps());
    expect(parseUrl(result.url).params.get("model")).toBe(DEFAULT_MODEL);
  });

  it("moves the browser token into the Authorization header (never in the URL)", async () => {
    const d = deps();
    const result = await buildAzureUrl(
      { model: "gpt-realtime", token: BROWSER_TOKEN },
      cfg({ foundryApiKey: API_KEY }),
      d
    );
    const { pathname, params } = parseUrl(result.url);

    expect(pathname).toBe(REALTIME_PATH);
    expect(params.get("model")).toBe("gpt-realtime");
    expect(params.has("token")).toBe(false);
    expect(params.has("Authorization")).toBe(false);
    expect(params.has("api-key")).toBe(false); // token beats API key
    expect(result.url).not.toContain(BROWSER_TOKEN);
    expect(result.headers).toEqual({ Authorization: `Bearer ${BROWSER_TOKEN}` });
    expect(result.authMethod).toBe("msal-token");
    expect(result.mode).toBe("standard");
    expect(d.getEntraToken).not.toHaveBeenCalled();
  });

  it("falls back to DefaultAzureCredential when neither token nor API key is available", async () => {
    const d = deps();
    const result = await buildAzureUrl({ model: "gpt-realtime" }, cfg(), d);
    const { pathname, params } = parseUrl(result.url);

    expect(d.getEntraToken).toHaveBeenCalledTimes(1);
    expect(pathname).toBe(REALTIME_PATH);
    expect(params.get("model")).toBe("gpt-realtime");
    expect(params.has("api-key")).toBe(false);
    expect(result.url).not.toContain(ENTRA_TOKEN);
    expect(result.headers).toEqual({ Authorization: `Bearer ${ENTRA_TOKEN}` });
    expect(result.authMethod).toBe("entra-credential");
    expect(result.mode).toBe("standard");
  });

  it("propagates DefaultAzureCredential failures", async () => {
    const d: UrlBuildDeps = {
      getEntraToken: vi.fn().mockRejectedValue(new Error("az login required")),
    };
    await expect(buildAzureUrl({ model: "gpt-realtime" }, cfg(), d)).rejects.toThrow(
      "az login required"
    );
  });

  it("throws when the resource name is missing", async () => {
    await expect(buildAzureUrl({}, cfg({ azureResourceName: "" }), deps())).rejects.toThrow(
      /FOUNDRY_RESOURCE_NAME/
    );
  });
});

describe("buildAzureUrl - Foundry Agents", () => {
  const fullAgentQuery: QueryParams = {
    agentName: "My Agent",
    projectName: "my-project",
    conversationId: "conv_abc123",
    agentVersion: "1.0",
    agentAuthenticationIdentityClientId: "00000000-0000-0000-0000-000000000abc",
    foundryResourceOverride: "other-resource",
    token: BROWSER_TOKEN,
  };

  it("passes all agent params upstream and moves the token into the Authorization header", async () => {
    const d = deps();
    const result = await buildAzureUrl(fullAgentQuery, cfg({ foundryApiKey: API_KEY }), d);
    const { origin, pathname, params } = parseUrl(result.url);

    expect(origin).toBe(ORIGIN);
    expect(pathname).toBe(REALTIME_PATH);
    expect(params.get("api-version")).toBe(DEFAULT_API_VERSION);
    expect(params.get("agent-name")).toBe("My Agent");
    expect(result.url).toContain("agent-name=My%20Agent"); // encodeURIComponent, not '+'
    expect(params.get("agent-project-name")).toBe("my-project");
    expect(params.get("conversation-id")).toBe("conv_abc123");
    expect(params.get("agent-version")).toBe("1.0");
    expect(params.get("agent-authentication-identity-client-id")).toBe(
      "00000000-0000-0000-0000-000000000abc"
    );
    expect(params.get("foundry-resource-override")).toBe("other-resource");
    expect(params.has("model")).toBe(false);
    expect(params.has("api-key")).toBe(false); // API key is never used in agent mode
    expect(params.has("token")).toBe(false);
    expect(result.url).not.toContain(BROWSER_TOKEN);
    expect(result.headers).toEqual({ Authorization: `Bearer ${BROWSER_TOKEN}` });
    expect(result.mode).toBe("foundry-agent");
    expect(result.authMethod).toBe("msal-token");
    expect(result.transport).toBe("websocket");
    expect(d.getEntraToken).not.toHaveBeenCalled();
  });

  it("omits optional agent params when they are not provided", async () => {
    const result = await buildAzureUrl(
      { agentName: "MyAgent", projectName: "my-project", token: BROWSER_TOKEN },
      cfg(),
      deps()
    );
    const { params } = parseUrl(result.url);

    expect([...params.keys()].sort()).toEqual(["agent-name", "agent-project-name", "api-version"]);
  });

  it("uses DefaultAzureCredential when no browser token is passed", async () => {
    const d = deps();
    const result = await buildAzureUrl(
      { agentName: "MyAgent", projectName: "my-project" },
      cfg(),
      d
    );

    expect(d.getEntraToken).toHaveBeenCalledTimes(1);
    expect(result.headers).toEqual({ Authorization: `Bearer ${ENTRA_TOKEN}` });
    expect(result.authMethod).toBe("entra-credential");
    expect(result.mode).toBe("foundry-agent");
    expect(result.url).not.toContain(ENTRA_TOKEN);
  });

  it("throws when projectName is missing", async () => {
    const d = deps();
    await expect(
      buildAzureUrl({ agentName: "MyAgent", token: BROWSER_TOKEN }, cfg(), d)
    ).rejects.toThrow(/agentName and projectName/);
    expect(d.getEntraToken).not.toHaveBeenCalled();
  });

  it("uses .env agent/project as fallback when the model param is absent", async () => {
    const envCfg = cfg({ foundryAgentName: "EnvAgent", foundryProjectName: "env-project" });
    const result = await buildAzureUrl({}, envCfg, deps());
    const { params } = parseUrl(result.url);

    expect(result.mode).toBe("foundry-agent");
    expect(params.get("agent-name")).toBe("EnvAgent");
    expect(params.get("agent-project-name")).toBe("env-project");
    expect(params.has("model")).toBe(false);
  });

  it("ignores the .env agent fallback when the model param is present (standard request)", async () => {
    const envCfg = cfg({
      foundryAgentName: "EnvAgent",
      foundryProjectName: "env-project",
      foundryApiKey: API_KEY,
    });
    const result = await buildAzureUrl({ model: "gpt-realtime" }, envCfg, deps());
    const { params } = parseUrl(result.url);

    expect(result.mode).toBe("standard");
    expect(result.authMethod).toBe("api-key");
    expect(params.get("model")).toBe("gpt-realtime");
    expect(params.has("agent-name")).toBe(false);
    expect(params.has("agent-project-name")).toBe(false);
  });

  it("combines a URL agentName with the .env projectName", async () => {
    const envCfg = cfg({ foundryProjectName: "env-project" });
    const result = await buildAzureUrl(
      { agentName: "UrlAgent", token: BROWSER_TOKEN },
      envCfg,
      deps()
    );
    const { params } = parseUrl(result.url);

    expect(params.get("agent-name")).toBe("UrlAgent");
    expect(params.get("agent-project-name")).toBe("env-project");
  });
});

describe("buildAzureUrl - API version precedence", () => {
  it("uses the built-in GA default when nothing is configured", async () => {
    const result = await buildAzureUrl(
      { model: "gpt-realtime" },
      cfg({ foundryApiKey: API_KEY }),
      deps()
    );
    expect(parseUrl(result.url).params.get("api-version")).toBe("2026-07-15");
  });

  it("API_VERSION (config) beats the default", async () => {
    const result = await buildAzureUrl(
      { model: "gpt-realtime" },
      cfg({ foundryApiKey: API_KEY, apiVersion: "2025-10-01" }),
      deps()
    );
    expect(parseUrl(result.url).params.get("api-version")).toBe("2025-10-01");
  });

  it("?apiVersion= beats API_VERSION", async () => {
    const result = await buildAzureUrl(
      { model: "gpt-realtime", apiVersion: "2026-01-01-preview" },
      cfg({ foundryApiKey: API_KEY, apiVersion: "2025-10-01" }),
      deps()
    );
    expect(parseUrl(result.url).params.get("api-version")).toBe("2026-01-01-preview");
  });

  it("URL-encodes the API version", async () => {
    const result = await buildAzureUrl(
      { model: "gpt-realtime", apiVersion: "2026 01 01" },
      cfg({ foundryApiKey: API_KEY }),
      deps()
    );
    expect(result.url).toContain("api-version=2026%2001%2001");
  });
});

describe("buildAzureUrl - WebRTC transport", () => {
  it("routes to /voice-live/realtime/calls with the preview default API version (standard mode)", async () => {
    const result = await buildAzureUrl(
      { model: "gpt-realtime", transport: "webrtc" },
      cfg({ foundryApiKey: API_KEY }),
      deps()
    );
    const { origin, pathname, params } = parseUrl(result.url);

    expect(origin).toBe(ORIGIN);
    expect(pathname).toBe(REALTIME_CALLS_PATH);
    expect(params.get("api-version")).toBe(DEFAULT_WEBRTC_API_VERSION);
    expect(params.get("model")).toBe("gpt-realtime");
    expect(params.get("api-key")).toBe(API_KEY);
    expect(params.has("transport")).toBe(false); // proxy-only param, not forwarded
    expect(result.transport).toBe("webrtc");
    expect(result.mode).toBe("standard");
    expect(result.authMethod).toBe("api-key");
  });

  it("routes agent mode to /voice-live/realtime/calls too", async () => {
    const result = await buildAzureUrl(
      {
        agentName: "MyAgent",
        projectName: "my-project",
        transport: "webrtc",
        token: BROWSER_TOKEN,
      },
      cfg(),
      deps()
    );
    const { pathname, params } = parseUrl(result.url);

    expect(pathname).toBe(REALTIME_CALLS_PATH);
    expect(params.get("api-version")).toBe(DEFAULT_WEBRTC_API_VERSION);
    expect(params.get("agent-name")).toBe("MyAgent");
    expect(result.transport).toBe("webrtc");
    expect(result.mode).toBe("foundry-agent");
    expect(result.headers).toEqual({ Authorization: `Bearer ${BROWSER_TOKEN}` });
  });

  it("respects an explicit ?apiVersion= for WebRTC", async () => {
    const result = await buildAzureUrl(
      { model: "gpt-realtime", transport: "webrtc", apiVersion: "2026-01-01-preview" },
      cfg({ foundryApiKey: API_KEY }),
      deps()
    );
    const { pathname, params } = parseUrl(result.url);

    expect(pathname).toBe(REALTIME_CALLS_PATH);
    expect(params.get("api-version")).toBe("2026-01-01-preview");
  });

  it("respects API_VERSION (config) for WebRTC", async () => {
    const result = await buildAzureUrl(
      { model: "gpt-realtime", transport: "webrtc" },
      cfg({ foundryApiKey: API_KEY, apiVersion: "2026-01-01-preview" }),
      deps()
    );
    expect(parseUrl(result.url).params.get("api-version")).toBe("2026-01-01-preview");
  });

  it("keeps the /voice-live/realtime path for the default websocket transport", async () => {
    const result = await buildAzureUrl(
      { model: "gpt-realtime", transport: "websocket" },
      cfg({ foundryApiKey: API_KEY }),
      deps()
    );
    expect(parseUrl(result.url).pathname).toBe(REALTIME_PATH);
    expect(result.transport).toBe("websocket");
  });

  it("rejects unknown transports", async () => {
    await expect(
      buildAzureUrl(
        { model: "gpt-realtime", transport: "ws" },
        cfg({ foundryApiKey: API_KEY }),
        deps()
      )
    ).rejects.toThrow(/Unsupported transport/);
  });
});

describe("redactUrl", () => {
  it("masks token, api-key and Authorization values", () => {
    const url =
      "/ws?model=gpt-realtime&token=secret-token&api-key=secret-key&Authorization=Bearer%20abc&authorization=Bearer%20def";
    const redacted = redactUrl(url);

    expect(redacted).toBe(
      "/ws?model=gpt-realtime&token=REDACTED&api-key=REDACTED&Authorization=REDACTED&authorization=REDACTED"
    );
    expect(redacted).not.toContain("secret");
    expect(redacted).not.toContain("abc");
  });

  it("masks a secret in the first query position", () => {
    expect(redactUrl("wss://x.services.ai.azure.com/voice-live/realtime?api-key=k&model=m")).toBe(
      "wss://x.services.ai.azure.com/voice-live/realtime?api-key=REDACTED&model=m"
    );
  });

  it("leaves non-secret params and URLs without a query untouched", () => {
    const url =
      "/ws?agentName=MyAgent&projectName=p&transport=webrtc&apiVersion=2026-06-01-preview";
    expect(redactUrl(url)).toBe(url);
    expect(redactUrl("/ws")).toBe("/ws");
    expect(redactUrl("")).toBe("");
  });

  it("does not mask params that merely end with a secret name", () => {
    expect(redactUrl("/ws?myToken=keep&api-key-id=keep")).toBe("/ws?myToken=keep&api-key-id=keep");
  });
});

describe("redactUrl (encoded parameter names)", () => {
  it("redacts secrets whose parameter name is percent-encoded", () => {
    // the server decodes the key and authenticates with it, so the logger must decode it too
    expect(redactUrl("/ws?to%6Ben=SECRET")).not.toContain("SECRET");
    expect(redactUrl("/ws?TOKEN=SECRET")).not.toContain("SECRET");
    expect(redactUrl("wss://host/ws?api%2Dkey=SECRET")).not.toContain("SECRET");
  });

  it("still redacts the plain forms and leaves everything else intact", () => {
    expect(redactUrl("/ws?model=gpt-realtime&token=SECRET")).toBe("/ws?model=gpt-realtime&token=REDACTED");
    expect(redactUrl("/ws?model=gpt-realtime")).toBe("/ws?model=gpt-realtime");
    expect(redactUrl("wss://host/voice-live/realtime?api-version=2026-07-15&api-key=SECRET")).not.toContain("SECRET");
  });
});
