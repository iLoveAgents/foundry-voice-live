/* eslint-disable @typescript-eslint/explicit-function-return-type */
// @vitest-environment node
/**
 * Protocol contract test — verifies our wire format against Microsoft's official
 * `@azure/ai-voicelive` SDK (devDependency only; never shipped).
 *
 * If Microsoft changes a wire key or event name, this test fails on the next
 * devDependency bump instead of silently breaking sessions.
 *
 * The SDK's serializers live in an internal module (not part of its `exports` map),
 * so we load `dist/esm/models/models.js` directly.
 *
 * `@azure/ai-voicelive` declares `engines: { node: '>=22' }`, which is why the repo's dev
 * environment and CI run Node 22 (root `package.json` engines). The published packages are
 * unaffected — this dependency is dev-only.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { convertToSessionUpdate } from './sessionBuilder';
import { buildGreetingEvents } from './greeting';
import { SERVER_EVENT_TYPES, CLIENT_EVENT_TYPES } from '../types/events';
import type { VoiceLiveSessionConfig } from '../types/voiceLive';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AzureModels = Record<string, any>;

let azure: AzureModels;

beforeAll(async () => {
  const modelsUrl = new URL('../node_modules/@azure/ai-voicelive/dist/esm/models/models.js', import.meta.url);
  azure = await import(/* @vite-ignore */ modelsUrl.href);
});

// ---------------------------------------------------------------------------
// Event names
// ---------------------------------------------------------------------------

// The runtime name lists live next to the types (types/events.ts) and are kept complete by
// compile-time checks there; this test verifies them against Microsoft's SDK enums.
const OUR_SERVER_EVENTS = SERVER_EVENT_TYPES;
const OUR_CLIENT_EVENTS = CLIENT_EVENT_TYPES;

/**
 * Events documented by Microsoft (WebRTC how-to / API reference) that the JS SDK 1.1.0
 * does not enumerate. Re-check on every SDK bump — remove entries once they appear.
 */
const NOT_IN_SDK_ENUM_YET = new Set<string>([
  'rtc.call.sdp.created',
  'rtc.call.error',
  'rtc.call.sdp.create',
  'response.foundry_agent_call_arguments.delta',
  'response.foundry_agent_call_arguments.done',
  'response.foundry_agent_call.in_progress',
  'response.foundry_agent_call.completed',
  'response.foundry_agent_call.failed',
  'rate_limits.updated',
  // Observed live on the WebRTC transport (August 2026): playback lifecycle on the data channel
  'output_audio_buffer.started',
  'output_audio_buffer.stopped',
]);

describe('event names match the official SDK enums', () => {
  it('server event names are known to @azure/ai-voicelive', () => {
    const known = new Set<string>(Object.values<string>(azure.KnownServerEventType));
    const unknown = OUR_SERVER_EVENTS.filter((name) => !known.has(name) && !NOT_IN_SDK_ENUM_YET.has(name));
    expect(unknown).toEqual([]);
  });

  it('client event names are known to @azure/ai-voicelive', () => {
    const known = new Set<string>(Object.values<string>(azure.KnownClientEventType));
    const unknown = OUR_CLIENT_EVENTS.filter((name) => !known.has(name) && !NOT_IN_SDK_ENUM_YET.has(name));
    expect(unknown).toEqual([]);
  });

  it('allow-listed names that the SDK now knows should be removed from the allow-list', () => {
    const known = new Set<string>([
      ...Object.values<string>(azure.KnownServerEventType),
      ...Object.values<string>(azure.KnownClientEventType),
    ]);
    const stale = [...NOT_IN_SDK_ENUM_YET].filter((name) => known.has(name));
    expect(stale).toEqual([]);
  });

  it('the SDK does not know server events we have not modelled (informational)', () => {
    const ours = new Set<string>(OUR_SERVER_EVENTS);
    const missing = Object.values<string>(azure.KnownServerEventType).filter((name) => !ours.has(name));
    // Keep this list explicit so new upstream events are noticed on SDK bumps.
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// session.update wire format
// ---------------------------------------------------------------------------

describe('session.update wire format matches requestSessionSerializer', () => {
  it('serializes a fully-featured session identically', () => {
    const ours: VoiceLiveSessionConfig = {
      instructions: 'You are helpful.',
      modalities: ['text', 'audio'],
      temperature: 0.7,
      maxResponseOutputTokens: 1024,
      reasoningEffort: 'low',
      metadata: { tenant: 'contoso' },
      inputAudioFormat: 'pcm16',
      outputAudioFormat: 'pcm16',
      inputAudioSamplingRate: 24000,
      inputAudioEchoCancellation: { type: 'server_echo_cancellation', referenceSource: 'client', channels: 2 },
      inputAudioNoiseReduction: { type: 'azure_deep_noise_suppression' },
      inputAudioTranscription: {
        model: 'azure-speech',
        language: 'en',
        phraseList: ['Neo QLED'],
        customSpeech: { 'zh-CN': 'model-1' },
      },
      voice: {
        name: 'en-US-Ava:DragonHDLatestNeural',
        type: 'azure-standard',
        temperature: 0.8,
        rate: '1.1',
        pitch: '+5%',
        volume: 'loud',
        style: 'cheerful',
        preferLocales: ['en-GB'],
        locale: 'en-US',
        customLexiconUrl: 'https://example.com/lex.xml',
        customTextNormalizationUrl: 'https://example.com/tn.xml',
      },
      turnDetection: {
        type: 'azure_semantic_vad',
        threshold: 0.5,
        prefixPaddingMs: 300,
        speechDurationMs: 80,
        silenceDurationMs: 500,
        removeFillerWords: true,
        languages: ['en'],
        autoTruncate: true,
        createResponse: true,
        interruptResponse: true,
        endOfUtteranceDetection: { model: 'semantic_detection_v1', thresholdLevel: 'medium', timeoutMs: 1000 },
      },
      tools: [
        { type: 'function', name: 'get_weather', description: 'Weather', parameters: { type: 'object' } },
        {
          type: 'mcp',
          serverLabel: 'mslearn',
          serverUrl: 'https://learn.microsoft.com/api/mcp',
          allowedTools: ['search'],
          headers: { 'x-a': 'b' },
          authorization: 'Bearer x',
          requireApproval: 'always',
        },
      ],
      toolChoice: 'auto',
      outputAudioTimestampTypes: ['word'],
      animation: { outputs: ['viseme_id'] },
      interimResponse: {
        type: 'llm_interim_response',
        triggers: ['tool', 'latency'],
        latencyThresholdInMs: 1500,
        model: 'gpt-4.1-mini',
        instructions: 'Be brief.',
        maxCompletionTokens: 30,
      },
      avatar: {
        character: 'lisa',
        style: 'casual-sitting',
        customized: false,
        iceServers: [{ urls: ['turn:example.com'], username: 'u', credential: 'c' }],
        video: {
          codec: 'h264',
          bitrate: 2000000,
          resolution: { width: 1920, height: 1080 },
          crop: { topLeft: [0.1, 0.1], bottomRight: [0.9, 0.9] },
          background: { color: '#00FF00FF', imageUrl: 'https://example.com/bg.jpg' },
        },
      },
    };

    const theirs = azure.requestSessionSerializer({
      instructions: 'You are helpful.',
      modalities: ['text', 'audio'],
      temperature: 0.7,
      maxResponseOutputTokens: 1024,
      reasoningEffort: 'low',
      metadata: { tenant: 'contoso' },
      inputAudioFormat: 'pcm16',
      outputAudioFormat: 'pcm16',
      inputAudioSamplingRate: 24000,
      inputAudioEchoCancellation: { type: 'server_echo_cancellation', referenceSource: 'client', channels: 2 },
      inputAudioNoiseReduction: { type: 'azure_deep_noise_suppression' },
      inputAudioTranscription: {
        model: 'azure-speech',
        language: 'en',
        phraseList: ['Neo QLED'],
        customSpeech: { 'zh-CN': 'model-1' },
      },
      voice: {
        name: 'en-US-Ava:DragonHDLatestNeural',
        type: 'azure-standard',
        temperature: 0.8,
        rate: '1.1',
        pitch: '+5%',
        volume: 'loud',
        style: 'cheerful',
        preferLocales: ['en-GB'],
        locale: 'en-US',
        customLexiconUrl: 'https://example.com/lex.xml',
        customTextNormalizationUrl: 'https://example.com/tn.xml',
      },
      turnDetection: {
        type: 'azure_semantic_vad',
        threshold: 0.5,
        prefixPaddingInMs: 300,
        speechDurationInMs: 80,
        silenceDurationInMs: 500,
        removeFillerWords: true,
        languages: ['en'],
        autoTruncate: true,
        createResponse: true,
        interruptResponse: true,
        endOfUtteranceDetection: { model: 'semantic_detection_v1', thresholdLevel: 'medium', timeoutInMs: 1000 },
      },
      tools: [
        { type: 'function', name: 'get_weather', description: 'Weather', parameters: { type: 'object' } },
        {
          type: 'mcp',
          serverLabel: 'mslearn',
          serverUrl: 'https://learn.microsoft.com/api/mcp',
          allowedTools: ['search'],
          headers: { 'x-a': 'b' },
          authorization: 'Bearer x',
          requireApproval: 'always',
        },
      ],
      toolChoice: 'auto',
      outputAudioTimestampTypes: ['word'],
      animation: { outputs: ['viseme_id'] },
      interimResponse: {
        type: 'llm_interim_response',
        triggers: ['tool', 'latency'],
        latencyThresholdInMs: 1500,
        model: 'gpt-4.1-mini',
        instructions: 'Be brief.',
        maxCompletionTokens: 30,
      },
      avatar: {
        character: 'lisa',
        style: 'casual-sitting',
        customized: false,
        iceServers: [{ urls: ['turn:example.com'], username: 'u', credential: 'c' }],
        video: {
          codec: 'h264',
          bitrate: 2000000,
          resolution: { width: 1920, height: 1080 },
          crop: { topLeft: [0.1, 0.1], bottomRight: [0.9, 0.9] },
          background: { color: '#00FF00FF', imageUrl: 'https://example.com/bg.jpg' },
        },
      },
    });

    // toEqual ignores keys whose value is undefined (the SDK emits them, we omit them)
    expect(convertToSessionUpdate(ours)).toEqual(theirs);
  });

  it('serializes static interim responses, personal / native voices and server_vad identically', () => {
    const ours = convertToSessionUpdate({
      voice: { name: 'my-personal', type: 'azure-personal', model: 'DragonHDOmniLatestNeural', temperature: 0.6 },
      turnDetection: {
        type: 'server_vad',
        threshold: 0.4,
        prefixPaddingMs: 200,
        silenceDurationMs: 600,
        createResponse: false,
        interruptResponse: true,
      },
      interimResponse: {
        type: 'static_interim_response',
        triggers: ['tool'],
        latencyThresholdInMs: 2000,
        texts: ['One moment', 'Let me check'],
      },
    });
    const theirs = azure.requestSessionSerializer({
      voice: { name: 'my-personal', type: 'azure-personal', model: 'DragonHDOmniLatestNeural', temperature: 0.6 },
      turnDetection: {
        type: 'server_vad',
        threshold: 0.4,
        prefixPaddingInMs: 200,
        silenceDurationInMs: 600,
        createResponse: false,
        interruptResponse: true,
      },
      interimResponse: {
        type: 'static_interim_response',
        triggers: ['tool'],
        latencyThresholdInMs: 2000,
        texts: ['One moment', 'Let me check'],
      },
    });
    expect(ours).toEqual(theirs);

    expect(convertToSessionUpdate({ voice: { name: 'ava', type: 'azure-realtime-native' } }).voice).toEqual(
      azure.requestSessionSerializer({ voice: { name: 'ava', type: 'azure-realtime-native' } }).voice
    );
    expect(convertToSessionUpdate({ voice: { name: 'marin', type: 'openai' } }).voice).toEqual(
      azure.requestSessionSerializer({ voice: { name: 'marin', type: 'openai' } }).voice
    );
  });

  it('serializes MCP per-tool approval objects identically', () => {
    const requireApproval = { always: ['submit'], never: ['search'] };
    const ours = convertToSessionUpdate({
      tools: [{ type: 'mcp', serverLabel: 'a', serverUrl: 'https://a', requireApproval }],
    });
    const theirs = azure.requestSessionSerializer({
      tools: [{ type: 'mcp', serverLabel: 'a', serverUrl: 'https://a', requireApproval }],
    });
    expect(ours.tools).toEqual(theirs.tools);
  });
});

// ---------------------------------------------------------------------------
// Client events
// ---------------------------------------------------------------------------

describe('client events match the official SDK serializers', () => {
  it('pre-generated greeting matches response.create with preGeneratedAssistantMessage', () => {
    const [ours] = buildGreetingEvents({ type: 'pregenerated', text: 'Hi Lisa!' }, 1);
    const theirs = azure.clientEventResponseCreateSerializer({
      type: 'response.create',
      eventId: 'evt_greeting_1',
      response: {
        preGeneratedAssistantMessage: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi Lisa!' }],
        },
      },
    });
    expect(ours).toEqual(theirs);
  });

  it('LLM greeting matches a system message item + response.create', () => {
    const [item, create] = buildGreetingEvents({ type: 'llm', text: 'Greet the user.' }, 2);
    expect(item).toEqual(
      azure.clientEventConversationItemCreateSerializer({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: 'Greet the user.' }] },
      })
    );
    expect(create).toEqual(
      azure.clientEventResponseCreateSerializer({ type: 'response.create', eventId: 'evt_llmgreeting_2' })
    );
  });

  it('function_call_output and mcp_approval_response items match', () => {
    expect({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: 'call_1', output: '{"ok":true}' },
    }).toEqual(
      azure.clientEventConversationItemCreateSerializer({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', callId: 'call_1', output: '{"ok":true}' },
      })
    );

    expect({
      type: 'conversation.item.create',
      item: { type: 'mcp_approval_response', approval_request_id: 'req_1', approve: true },
    }).toEqual(
      azure.clientEventConversationItemCreateSerializer({
        type: 'conversation.item.create',
        item: { type: 'mcp_approval_response', approvalRequestId: 'req_1', approve: true },
      })
    );
  });

  it('user text message item matches', () => {
    expect({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello' }] },
    }).toEqual(
      azure.clientEventConversationItemCreateSerializer({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello' }] },
      })
    );
  });
});
