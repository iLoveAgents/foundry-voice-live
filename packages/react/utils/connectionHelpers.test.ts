import { describe, expect, it } from 'vitest';
import { buildConnectionUrl, redactConnectionUrl } from './connectionHelpers';

describe('Voice Live connection URLs', () => {
  it('uses the calls endpoint for direct WebRTC and preserves explicit proxy transport', () => {
    const direct = buildConnectionUrl({ resourceName: 'example', token: 'token', transport: 'webrtc' });
    expect(new URL(direct.url).pathname).toBe('/voice-live/realtime/calls');
    expect(direct.transport).toBe('webrtc');
    const proxied = buildConnectionUrl({ proxyUrl: 'ws://localhost/ws?transport=websocket', transport: 'webrtc' });
    expect(proxied.transport).toBe('websocket');
    expect(() => buildConnectionUrl({ proxyUrl: 'ws://localhost/ws?transport=invalid' })).toThrow('transport');
  });
  it('uses the GA API and browser-supported Authorization query authentication', () => {
    const result = buildConnectionUrl({ resourceName: 'example', token: 'token+/=' });
    const url = new URL(result.url);
    expect(url.searchParams.get('api-version')).toBe('2026-07-15');
    expect(url.searchParams.get('Authorization')).toBe('Bearer token+/=');
    expect(url.searchParams.has('token')).toBe(false);
    expect(result.isAgentMode).toBe(false);
  });

  it('encodes agent names, version, conversation, and preview flags', () => {
    const result = buildConnectionUrl({
      resourceName: 'example', token: 'token', agentName: 'agent & name',
      projectName: 'project', agentVersion: '2', conversationId: 'conv/1',
      authenticationIdentityClientId: 'identity-id',
      previewFeatures: ['client_ec_reference'], apiVersion: '2026-06-01-preview',
    });
    const query = new URL(result.url).searchParams;
    expect(result.isAgentMode).toBe(true);
    expect(query.get('agent-name')).toBe('agent & name');
    expect(query.get('agent-version')).toBe('2');
    expect(query.get('conversation-id')).toBe('conv/1');
    expect(query.get('agent-authentication-identity-client-id')).toBe('identity-id');
    expect(query.get('features')).toBe('client_ec_reference:true');
    expect(query.get('api-version')).toBe('2026-06-01-preview');
    expect(query.has('model')).toBe(false);
  });

  it('keeps classic agent auth separate from API-key authentication', () => {
    const query = new URL(buildConnectionUrl({ resourceName: 'example',
      apiKey: 'key', agentAccessToken: 'agent token', agentId: 'asst_1', projectName: 'project',
    }).url).searchParams;
    expect(query.get('api-key')).toBe('key');
    expect(query.get('agent-access-token')).toBe('agent token');
    expect(query.has('Authorization')).toBe(false);
  });

  it('adds typed proxy options while preserving explicit URL values', () => {
    const result = buildConnectionUrl({
      proxyUrl: 'ws://localhost:8080/ws?agentName=selected&token=existing',
      agentName: 'fallback', projectName: 'project', token: 'new',
      previewFeatures: ['client_ec_reference'], profile: 'deployment-profile',
    });
    const query = new URL(result.url).searchParams;
    expect(query.get('agentName')).toBe('selected');
    expect(query.get('token')).toBe('existing');
    expect(query.get('projectName')).toBe('project');
    expect(query.get('features')).toBe('client_ec_reference:true');
    expect(query.get('profile')).toBe('deployment-profile');
    expect(result.isAgentMode).toBe(true);
  });

  it('recognizes only agent query parameters, not matching text inside values', () => {
    expect(buildConnectionUrl({ proxyUrl: 'ws://localhost/ws?model=agentName=x' }).isAgentMode).toBe(false);
    expect(buildConnectionUrl({ proxyUrl: 'ws://localhost/ws?projectName=project' }).isAgentMode).toBe(false);
    expect(buildConnectionUrl({ proxyUrl: 'ws://localhost/ws?agent-name=agent' }).isAgentMode).toBe(true);
    expect(buildConnectionUrl({ proxyUrl: 'ws://localhost/ws', agentMode: true }).isAgentMode).toBe(true);
  });

  it('forwards BYOM settings in the official wire format', () => {
    const query = new URL(buildConnectionUrl({ resourceName: 'example', token: 'token',
      profile: 'profile', foundryResourceOverride: 'resource',
    }).url).searchParams;
    expect(query.get('profile')).toBe('profile');
    expect(query.get('foundry-resource-override')).toBe('resource');
  });

  it('rejects incomplete direct connections instead of falling back to model mode', () => {
    expect(() => buildConnectionUrl({ token: 'token' })).toThrow('resourceName');
    expect(() => buildConnectionUrl({ resourceName: 'example', agentName: 'agent', token: 'token' })).toThrow('projectName');
    expect(() => buildConnectionUrl({ resourceName: 'example' })).toThrow('apiKey or Entra token');
  });

  it('redacts repeated and case-varied credential parameters', () => {
    const redacted = redactConnectionUrl('wss://example/ws?Authorization=secret1&token=secret2&token=secret3&API-KEY=secret4&agent-access-token=secret5&agentAccessToken=secret6&model=gpt-realtime');
    expect(redacted).not.toContain('secret');
    expect(new URL(redacted).searchParams.get('model')).toBe('gpt-realtime');
  });
});
