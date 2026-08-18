/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { describe, it, expect } from 'vitest';
import {
  buildVoiceLiveUrl,
  resolveConnectionMode,
  validateTransport,
  redactUrl,
  compareApiVersions,
} from './connectionUrl';
import { DEFAULT_API_VERSION, DEFAULT_WEBRTC_API_VERSION } from './constants';

const params = (url: string) => new URL(url).searchParams;

describe('resolveConnectionMode', () => {
  it('prefers proxy, then agent, then standard', () => {
    expect(resolveConnectionMode({ proxyUrl: 'ws://x/ws', agentName: 'a' })).toBe('proxy');
    expect(resolveConnectionMode({ resourceName: 'r', agentName: 'a', projectName: 'p' })).toBe('foundry-agent');
    expect(resolveConnectionMode({ resourceName: 'r', apiKey: 'k' })).toBe('standard');
  });
});

describe('buildVoiceLiveUrl — standard mode', () => {
  it('builds the realtime URL with default api-version and model, api-key auth', () => {
    const { url, mode, isAgentMode } = buildVoiceLiveUrl({ resourceName: 'my-res', apiKey: 'secret' });
    expect(url.startsWith('wss://my-res.services.ai.azure.com/voice-live/realtime?')).toBe(true);
    expect(params(url).get('api-version')).toBe(DEFAULT_API_VERSION);
    expect(params(url).get('model')).toBe('gpt-realtime');
    expect(params(url).get('api-key')).toBe('secret');
    expect(mode).toBe('standard');
    expect(isAgentMode).toBe(false);
  });

  it('uses the documented Authorization=Bearer query param for tokens (token wins over apiKey)', () => {
    const { url } = buildVoiceLiveUrl({ resourceName: 'r', token: 'tok', apiKey: 'k', model: 'azure-realtime' });
    expect(url).toContain('&Authorization=Bearer%20tok');
    expect(params(url).get('Authorization')).toBe('Bearer tok');
    expect(params(url).has('api-key')).toBe(false);
    expect(params(url).get('model')).toBe('azure-realtime');
  });

  it('respects an explicit apiVersion', () => {
    const { url } = buildVoiceLiveUrl({ resourceName: 'r', apiKey: 'k', apiVersion: '2026-04-10' });
    expect(params(url).get('api-version')).toBe('2026-04-10');
  });

  it('throws without credentials or resourceName', () => {
    expect(() => buildVoiceLiveUrl({ resourceName: 'r' })).toThrow(/apiKey or token/);
    expect(() => buildVoiceLiveUrl({ apiKey: 'k' })).toThrow(/resourceName/);
  });
});

describe('buildVoiceLiveUrl — Foundry Agents', () => {
  const base = { resourceName: 'r', agentName: 'My Agent', projectName: 'proj', token: 'tok' };

  it('builds agent-name/agent-project-name params with Bearer token', () => {
    const { url, mode, isAgentMode, modeLabel } = buildVoiceLiveUrl(base);
    expect(params(url).get('agent-name')).toBe('My Agent');
    expect(params(url).get('agent-project-name')).toBe('proj');
    expect(params(url).get('Authorization')).toBe('Bearer tok');
    expect(params(url).has('model')).toBe(false);
    expect(params(url).get('api-version')).toBe(DEFAULT_API_VERSION);
    expect(mode).toBe('foundry-agent');
    expect(isAgentMode).toBe(true);
    expect(modeLabel).toBe('Foundry Agent');
  });

  it('adds optional agent parameters', () => {
    const { url } = buildVoiceLiveUrl({
      ...base,
      conversationId: 'conv-1',
      agentVersion: '3',
      agentAuthenticationIdentityClientId: 'client-id',
      foundryResourceOverride: 'other-res',
    });
    expect(params(url).get('conversation-id')).toBe('conv-1');
    expect(params(url).get('agent-version')).toBe('3');
    expect(params(url).get('agent-authentication-identity-client-id')).toBe('client-id');
    expect(params(url).get('foundry-resource-override')).toBe('other-res');
  });

  it('throws when projectName or token is missing', () => {
    expect(() => buildVoiceLiveUrl({ resourceName: 'r', agentName: 'a', token: 't' })).toThrow(/projectName/);
    expect(() => buildVoiceLiveUrl({ resourceName: 'r', agentName: 'a', projectName: 'p' })).toThrow(/token/);
  });
});

describe('buildVoiceLiveUrl — proxy mode', () => {
  it('passes proxy URLs through untouched for websocket', () => {
    const proxyUrl = 'ws://localhost:8080/ws?model=gpt-realtime&token=abc';
    const { url, mode, isAgentMode } = buildVoiceLiveUrl({ proxyUrl });
    expect(url).toBe(proxyUrl);
    expect(mode).toBe('proxy');
    expect(isAgentMode).toBe(false);
  });

  it('detects agent mode from proxy query params or the agentMode flag', () => {
    expect(buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws?agentName=a&projectName=p' }).isAgentMode).toBe(true);
    expect(buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws', agentMode: true }).isAgentMode).toBe(true);
    expect(buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws?agentName=a', agentMode: false }).isAgentMode).toBe(false);
  });

  it('needs a non-empty agentName, like the proxy itself', () => {
    // the proxy routes to an agent only for a truthy agentName; assuming agent mode here would
    // strip instructions, tools, temperature and the voice from a standard session
    expect(buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws?model=gpt-realtime&projectName=p' }).isAgentMode).toBe(false);
    expect(buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws?agentName=' }).isAgentMode).toBe(false);
    expect(buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws?agentName=%20' }).isAgentMode).toBe(false);
    expect(buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws?agentName=support&projectName=p' }).isAgentMode).toBe(true);
  });

  it('forwards apiVersion to the proxy for the websocket transport too', () => {
    expect(buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws?model=gpt-4.1', apiVersion: '2026-06-01-preview' }).url).toBe(
      'ws://x/ws?model=gpt-4.1&apiVersion=2026-06-01-preview'
    );
  });

  it('appends transport=webrtc (and apiVersion when given) for the WebRTC transport', () => {
    expect(buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws?model=gpt-realtime', transport: 'webrtc' }).url).toBe(
      'ws://x/ws?model=gpt-realtime&transport=webrtc'
    );
    expect(buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws', transport: 'webrtc', apiVersion: '2026-06-01-preview' }).url).toBe(
      'ws://x/ws?transport=webrtc&apiVersion=2026-06-01-preview'
    );
    // no duplicates
    expect(buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws?transport=webrtc', transport: 'webrtc' }).url).toBe(
      'ws://x/ws?transport=webrtc'
    );
  });

  it('lets explicit connection settings override params already in the proxy URL', () => {
    expect(
      buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws?apiVersion=2026-07-15&transport=websocket', transport: 'webrtc', apiVersion: '2026-01-01-preview' }).url
    ).toBe('ws://x/ws?apiVersion=2026-01-01-preview&transport=webrtc');
  });

  it('overrides a stale transport=webrtc param when the caller selects the websocket transport', () => {
    // Reusing a proxy URL from a WebRTC page must not route a WebSocket session to /calls
    expect(buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws?transport=webrtc', transport: 'websocket' }).url).toBe(
      'ws://x/ws?transport=websocket'
    );
    // ...also when `transport` is omitted (defaults to websocket)
    expect(buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws?model=gpt-realtime&transport=webrtc' }).url).toBe(
      'ws://x/ws?model=gpt-realtime&transport=websocket'
    );
    // no transport param + websocket → URL stays untouched
    expect(buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws?model=gpt-realtime' }).url).toBe('ws://x/ws?model=gpt-realtime');
  });

  it('puts a per-user token on the proxy URL and replaces a stale one', () => {
    // documented pattern: proxyUrl + getToken (the hook resolves it into connection.token)
    expect(buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws?model=gpt-realtime', token: 'tok-1' }).url).toBe(
      'ws://x/ws?model=gpt-realtime&token=tok-1'
    );
    // a refreshed token must win over whatever the caller's URL carries
    expect(buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws?token=expired', token: 'tok-2' }).url).toBe(
      'ws://x/ws?token=tok-2'
    );
    // ...and without a token the URL is untouched (the proxy uses its own identity)
    expect(buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws?token=given-by-the-app' }).url).toBe(
      'ws://x/ws?token=given-by-the-app'
    );
  });

  it('replaces any transport value in a reused proxy URL, whatever its casing', () => {
    // the proxy lowercases and trims, so an exact comparison would let these through and the
    // socket would be routed to the WebRTC control endpoint while the SDK speaks WebSocket
    for (const value of ['WebRTC', 'WEBRTC', 'webrtc', 'nonsense']) {
      expect(buildVoiceLiveUrl({ proxyUrl: `ws://x/ws?transport=${value}` }).url).toBe(
        'ws://x/ws?transport=websocket'
      );
    }
    // and the WebRTC direction still wins over anything present
    expect(buildVoiceLiveUrl({ proxyUrl: 'ws://x/ws?transport=WEBSOCKET', transport: 'webrtc' }).url).toBe(
      'ws://x/ws?transport=webrtc'
    );
  });

  it('supports relative proxy URLs and origin-only URLs', () => {
    expect(buildVoiceLiveUrl({ proxyUrl: '/voice-live?model=gpt-realtime', transport: 'webrtc' }).url).toBe(
      '/voice-live?model=gpt-realtime&transport=webrtc'
    );
    expect(buildVoiceLiveUrl({ proxyUrl: 'wss://proxy.example.com', transport: 'webrtc' }).url).toBe(
      'wss://proxy.example.com/?transport=webrtc'
    );
    // untouched when nothing is added
    expect(buildVoiceLiveUrl({ proxyUrl: '/voice-live?token=a%2Bb' }).url).toBe('/voice-live?token=a%2Bb');
  });
});

describe('buildVoiceLiveUrl — WebRTC transport', () => {
  it('uses the /calls path and the preview default api-version', () => {
    const { url } = buildVoiceLiveUrl({ resourceName: 'r', apiKey: 'k', transport: 'webrtc' });
    expect(url.startsWith('wss://r.services.ai.azure.com/voice-live/realtime/calls?')).toBe(true);
    expect(params(url).get('api-version')).toBe(DEFAULT_WEBRTC_API_VERSION);
    expect(params(url).get('model')).toBe('gpt-realtime');
  });

  it('keeps websocket URLs unchanged when transport is omitted', () => {
    const a = buildVoiceLiveUrl({ resourceName: 'r', apiKey: 'k' }).url;
    const b = buildVoiceLiveUrl({ resourceName: 'r', apiKey: 'k', transport: 'websocket' }).url;
    expect(a).toBe(b);
    expect(a).not.toContain('/calls');
  });
});

describe('validateTransport', () => {
  it('is a no-op for websocket', () => {
    expect(() => validateTransport({ resourceName: 'r' }, { avatar: { character: 'lisa', style: 's' } }, false)).not.toThrow();
  });

  it('rejects avatar, old api versions and missing RTCPeerConnection for webrtc', () => {
    expect(() =>
      validateTransport({ transport: 'webrtc' }, { avatar: { character: 'lisa', style: 's' } }, true)
    ).toThrow(/Avatar is not supported/);
    expect(() => validateTransport({ transport: 'webrtc', apiVersion: '2025-10-01' }, undefined, true)).toThrow(
      /2026-01-01-preview/
    );
    expect(() => validateTransport({ transport: 'webrtc' }, undefined, false)).toThrow(/RTCPeerConnection/);
    expect(() => validateTransport({ transport: 'webrtc', apiVersion: '2026-07-15' }, undefined, true)).not.toThrow();
  });
});

describe('compareApiVersions', () => {
  it('compares by date and ignores the -preview suffix', () => {
    expect(compareApiVersions('2026-01-01-preview', '2025-10-01')).toBeGreaterThan(0);
    expect(compareApiVersions('2026-06-01-preview', '2026-07-15')).toBeLessThan(0);
    expect(compareApiVersions('2026-07-15', '2026-07-15')).toBe(0);
  });
});

describe('redactUrl', () => {
  it('masks api-key, Authorization and token values', () => {
    const url =
      'wss://r.services.ai.azure.com/voice-live/realtime?api-version=2026-07-15&api-key=SECRET&Authorization=Bearer%20TOK&token=T2';
    const redacted = redactUrl(url);
    expect(redacted).not.toContain('SECRET');
    expect(redacted).not.toContain('TOK');
    expect(redacted).not.toContain('T2');
    expect(redacted).toContain('api-key=***');
    expect(redacted).toContain('Authorization=***');
    expect(redacted).toContain('token=***');
    expect(redacted).toContain('api-version=2026-07-15');
  });
});

describe('proxy URLs that carry a host without a scheme', () => {
  it('keeps the host of a protocol-relative proxy URL when parameters are added', () => {
    const { url } = buildVoiceLiveUrl({
      proxyUrl: '//proxy.example.com/ws',
      token: 'user-token',
    });
    // dropping the host would point the session (with the token) at the page's own origin
    expect(url.startsWith('//proxy.example.com/ws')).toBe(true);
    expect(url).toContain('token=user-token');
  });

  it('still serializes a path-only proxy URL as a path', () => {
    const { url } = buildVoiceLiveUrl({ proxyUrl: '/ws', token: 'user-token' });
    expect(url.startsWith('/ws?')).toBe(true);
  });
});

describe('redactUrl (encoded and differently-cased parameter names)', () => {
  it('masks a percent-encoded parameter name that a server still reads as a secret', () => {
    expect(redactUrl('wss://host/ws?to%6Ben=SECRET&model=gpt-realtime')).not.toContain('SECRET');
  });

  it('masks regardless of case', () => {
    expect(redactUrl('wss://host/ws?API-KEY=SECRET')).not.toContain('SECRET');
    expect(redactUrl('wss://host/ws?Authorization=Bearer%20SECRET')).not.toContain('SECRET');
  });

  it('leaves a URL without secrets byte-for-byte unchanged', () => {
    const url = 'wss://host/voice-live/realtime?api-version=2026-07-15&model=gpt-realtime';
    expect(redactUrl(url)).toBe(url);
  });
});
