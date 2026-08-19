/**
 * Live smoke test against a real Microsoft Foundry resource (dev tool — not shipped; `files` = dist only).
 *
 * Usage (after `pnpm run build`):
 *   FOUNDRY_RESOURCE_NAME=my-res \
 *   FOUNDRY_TOKEN=$(az account get-access-token --scope https://ai.azure.com/.default --query accessToken -o tsv) \
 *   [FOUNDRY_AGENT_NAME=... FOUNDRY_PROJECT_NAME=...] [FOUNDRY_API_KEY=...] pnpm run smoke:live
 *
 * Uses the SDK's own URL builder / session builder / greeting builder (built dist) to verify against the live service:
 *  1. Standard WS session (cascaded model + Azure voice + static interim response + tool + transcription + metadata):
 *     session.update accepted, pre-generated greeting produces audio, text turn triggers the tool,
 *     interim response fires, tool result → final answer.
 *  2. Foundry agent WS session (if agent env set): session.update accepted, text turn answered.
 *  3. WebRTC control channel probe on /calls (bogus SDP → expect rtc.call.error; proves endpoint + auth + api-version).
 *     Note: observed to require API-key auth (401 for Entra tokens) — set FOUNDRY_API_KEY to exercise it.
 *  4. azure-realtime + azure-realtime-native voice: session.update accepted.
 */
import WebSocket from 'ws';
import {
  buildVoiceLiveUrl,
  buildSessionConfig,
  buildAgentSessionConfig,
  buildGreetingEvents,
  redactUrl,
} from '../dist/index.mjs';

const resourceName = process.env.FOUNDRY_RESOURCE_NAME;
const token = process.env.FOUNDRY_TOKEN;
const apiKey = process.env.FOUNDRY_API_KEY;
const agentName = process.env.FOUNDRY_AGENT_NAME;
const projectName = process.env.FOUNDRY_PROJECT_NAME;
if (!resourceName || (!token && !apiKey)) {
  throw new Error('FOUNDRY_RESOURCE_NAME and FOUNDRY_TOKEN (or FOUNDRY_API_KEY) are required');
}
const auth = token ? { token } : { apiKey };

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

function openSession(url, { onEvent, onOpen, timeoutMs = 45000 }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const seen = [];
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`timeout; events seen: ${[...new Set(seen)].join(', ')}`));
    }, timeoutMs);
    const api = {
      ws,
      seen,
      send: (e) => ws.send(JSON.stringify(e)),
      done: (value) => {
        clearTimeout(timer);
        ws.close();
        resolve(value);
      },
      fail: (err) => {
        clearTimeout(timer);
        ws.close();
        reject(err);
      },
    };
    ws.on('open', () => {
      console.log('   ws open');
      try {
        onOpen?.(api);
      } catch (err) {
        api.fail(err);
      }
    });
    ws.on('message', (raw) => {
      const ev = JSON.parse(raw.toString());
      seen.push(ev.type);
      if (ev.type !== 'response.audio.delta' && ev.type !== 'response.audio_transcript.delta') {
        console.log(
          '   <-',
          ev.type,
          ev.type === 'error' || ev.type === 'rtc.call.error' ? JSON.stringify(ev.error) : ''
        );
      }
      try {
        onEvent(ev, api);
      } catch (err) {
        api.fail(err);
      }
    });
    ws.on('unexpected-response', (_req, resp) => api.fail(new Error(`HTTP ${resp.statusCode}`)));
    ws.on('error', (err) => api.fail(err));
    ws.on('close', (code, reason) => console.log(`   ws closed ${code} ${reason}`));
  });
}

// ---------------------------------------------------------------------------
// 1. Standard WS session — cascaded model with interim response, tool, transcription
// ---------------------------------------------------------------------------
async function testStandardSession() {
  const { url } = buildVoiceLiveUrl({ resourceName, ...auth, model: 'gpt-4.1' });
  console.log('\n[1] standard session', redactUrl(url));
  const session = buildSessionConfig({
    instructions: 'You are a terse assistant. Use the get_weather tool for weather questions.',
    voice: { name: 'en-US-AvaMultilingualNeural', type: 'azure-standard' },
    inputAudioTranscription: { model: 'azure-speech', language: 'en' },
    interimResponse: {
      type: 'static_interim_response',
      triggers: ['tool', 'latency'],
      latencyThresholdInMs: 300,
      texts: ['One moment please.'],
    },
    tools: [
      {
        type: 'function',
        name: 'get_weather',
        description: 'Get the weather for a city',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ],
    metadata: { smoke: 'foundry-voice-live' },
  });
  let phase = 'configure';
  let audioBytes = 0;
  let sawInterim = false;
  const transcripts = [];
  return openSession(url, {
    onEvent: (ev, api) => {
      if (ev.type === 'error') api.fail(new Error(`service error: ${JSON.stringify(ev.error)}`));
      if (ev.type === 'session.created') {
        api.send({ type: 'session.update', session });
      }
      if (ev.type === 'session.updated' && phase === 'configure') {
        record(
          'standard: session.update accepted (interim_response, tools, transcription, metadata)',
          true
        );
        phase = 'greeting';
        buildGreetingEvents({ type: 'pregenerated', text: 'Hello from the smoke test.' }).forEach(
          api.send
        );
      }
      if (ev.type === 'response.audio.delta') audioBytes += ev.delta.length;
      if (ev.type === 'response.audio_transcript.done') transcripts.push(ev.transcript);
      if (ev.type === 'response.done' && phase === 'greeting') {
        record(
          'standard: pre_generated_assistant_message greeting produced audio',
          audioBytes > 0,
          `${audioBytes} b64 chars, transcript="${transcripts.at(-1)}"`
        );
        phase = 'tool';
        audioBytes = 0;
        api.send({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'What is the weather in Berlin?' }],
          },
        });
        api.send({ type: 'response.create' });
      }
      if (ev.type === 'response.function_call_arguments.done' && phase === 'tool') {
        const callId = ev.call_id;
        record(
          'standard: model called the tool',
          ev.name === 'get_weather',
          `${ev.name}(${ev.arguments})`
        );
        setTimeout(() => {
          api.send({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify({ temperature: '21°C', condition: 'sunny' }),
            },
          });
          api.send({ type: 'response.create' });
          phase = 'answer';
        }, 1500); // give the interim response a chance to fire
      }
      if (ev.type === 'response.audio_transcript.done' && /one moment/i.test(ev.transcript || ''))
        sawInterim = true;
      if (ev.type === 'response.done' && phase === 'answer') {
        record(
          'standard: final answer after tool result',
          audioBytes > 0,
          `transcript="${transcripts.at(-1)}"`
        );
        record(
          'standard: static interim response fired during tool call',
          sawInterim,
          sawInterim ? '' : `(transcripts: ${transcripts.join(' | ')})`
        );
        api.done();
      }
    },
  });
}

// ---------------------------------------------------------------------------
// 2. Foundry agent session
// ---------------------------------------------------------------------------
async function testAgentSession() {
  if (!agentName || !projectName || !token) {
    console.log(
      '\n[2] agent session skipped (needs FOUNDRY_AGENT_NAME, FOUNDRY_PROJECT_NAME and FOUNDRY_TOKEN)'
    );
    return;
  }
  const { url } = buildVoiceLiveUrl({ resourceName, token, agentName, projectName });
  console.log('\n[2] agent session', redactUrl(url));
  const session = buildAgentSessionConfig({
    voice: { name: 'en-US-AvaMultilingualNeural', type: 'azure-standard' },
  });
  let phase = 'configure';
  let audioBytes = 0;
  return openSession(url, {
    timeoutMs: 60000,
    onEvent: (ev, api) => {
      if (ev.type === 'error') api.fail(new Error(`service error: ${JSON.stringify(ev.error)}`));
      if (ev.type === 'session.created') api.send({ type: 'session.update', session });
      if (ev.type === 'session.updated' && phase === 'configure') {
        record('agent: session.update accepted', true);
        phase = 'turn';
        api.send({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Say hello in one short sentence.' }],
          },
        });
        api.send({ type: 'response.create' });
      }
      if (ev.type === 'response.audio.delta') audioBytes += ev.delta.length;
      if (ev.type === 'response.done' && phase === 'turn') {
        record('agent: text turn answered with audio', audioBytes > 0, `${audioBytes} b64 chars`);
        api.done();
      }
    },
  });
}

// ---------------------------------------------------------------------------
// 3. WebRTC control channel probe
// ---------------------------------------------------------------------------
/**
 * @param apiVersion - explicit api-version to probe (undefined = SDK default)
 * @param expectUnserved - the probe documents a known quirk: this version does NOT serve
 *   /calls. A 404/close is then the expected (PASS) outcome; an answer is reported as a
 *   NOTE so the default constant can be bumped.
 */
async function testWebRtcProbe(apiVersion, { expectUnserved = false } = {}) {
  const { url } = buildVoiceLiveUrl({
    resourceName,
    ...auth,
    model: 'gpt-realtime',
    transport: 'webrtc',
    ...(apiVersion && { apiVersion }),
  });
  const label = `webrtc(${apiVersion ?? 'default'}, ${token ? 'token' : 'api-key'})`;
  console.log(`\n[3] ${label} control channel probe`, redactUrl(url));
  return openSession(url, {
    timeoutMs: 20000,
    // The /calls control channel does not emit anything until it receives an offer, so
    // send it on open (exactly what the hook does). Intentionally bogus SDP — we only
    // want the endpoint to answer on the rtc.call.* channel.
    onOpen: (api) => {
      api.send({
        type: 'rtc.call.sdp.create',
        sdp_offer: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n',
        session: buildSessionConfig({ instructions: 'hi' }),
      });
    },
    onEvent: (ev, api) => {
      if (ev.type === 'rtc.call.error' || ev.type === 'rtc.call.sdp.created') {
        const detail =
          ev.type === 'rtc.call.error' ? `${ev.error?.code}: ${ev.error?.message}` : 'SDP answer';
        record(
          expectUnserved
            ? `${label}: NOTE — this api-version now serves /calls; consider bumping DEFAULT_WEBRTC_API_VERSION`
            : `${label}: /calls reachable, answered ${ev.type} for bogus SDP`,
          true,
          detail
        );
        api.done();
      }
      if (ev.type === 'error') {
        record(`${label}: /calls endpoint`, expectUnserved, JSON.stringify(ev.error));
        api.done();
      }
    },
  }).catch((err) =>
    record(
      expectUnserved
        ? `${label}: /calls not served on this api-version (documented quirk)`
        : `${label}: /calls endpoint`,
      expectUnserved,
      err.message
    )
  );
}

// ---------------------------------------------------------------------------
// 4. azure-realtime + native voice
// ---------------------------------------------------------------------------
async function testAzureRealtime() {
  const { url } = buildVoiceLiveUrl({ resourceName, ...auth, model: 'azure-realtime' });
  console.log('\n[4] azure-realtime session', redactUrl(url));
  const session = buildSessionConfig({
    instructions: 'Be brief.',
    voice: { name: 'ava', type: 'azure-realtime-native' },
  });
  return openSession(url, {
    timeoutMs: 20000,
    onEvent: (ev, api) => {
      if (ev.type === 'error') {
        record(
          'azure-realtime: session.update with azure-realtime-native voice',
          false,
          JSON.stringify(ev.error)
        );
        api.done();
      }
      if (ev.type === 'session.created') api.send({ type: 'session.update', session });
      if (ev.type === 'session.updated') {
        record(
          'azure-realtime: session.update with azure-realtime-native voice accepted',
          true,
          `voice=${JSON.stringify(ev.session?.voice)}`
        );
        api.done();
      }
    },
  }).catch((err) => record('azure-realtime: session', false, err.message));
}

try {
  await testStandardSession();
} catch (err) {
  record('standard session', false, err.message);
}
try {
  await testAgentSession();
} catch (err) {
  record('agent session', false, err.message);
}
await testWebRtcProbe();
// Documented quirk (Aug 2026): the GA api-version does not serve /calls — a 404 is expected here
await testWebRtcProbe('2026-07-15', { expectUnserved: true });
await testAzureRealtime();

console.log('\n==== SUMMARY ====');
for (const r of results)
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
process.exit(results.some((r) => !r.ok) ? 1 : 0);
