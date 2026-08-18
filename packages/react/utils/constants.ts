/**
 * Voice Live API constants
 *
 * Single source of truth for API version defaults and other protocol constants.
 * Update these when Microsoft ships a new Voice Live API version.
 */

/**
 * Default Voice Live API version (GA).
 * Used for standard (model) mode and Foundry Agents v2.
 *
 * @see https://learn.microsoft.com/azure/ai-services/speech-service/releasenotes
 */
export const DEFAULT_API_VERSION = '2026-07-15';

/**
 * Default API version for the WebRTC transport (preview feature).
 * Live-verified (August 2026): the `/voice-live/realtime/calls` control channel is only
 * served on `2026-01-01-preview` — `2026-04-10` returns 404 and `2026-06-01-preview` 401.
 * Override via `connection.apiVersion` once Microsoft ships WebRTC on a newer version.
 */
export const DEFAULT_WEBRTC_API_VERSION = '2026-01-01-preview';

/**
 * Minimum API version that supports the WebRTC transport (`/voice-live/realtime/calls`).
 */
export const MIN_WEBRTC_API_VERSION = '2026-01-01-preview';

/**
 * Default model for standard (model) mode.
 */
export const DEFAULT_MODEL = 'gpt-realtime';

/**
 * WebRTC data channel label used by the Voice Live service for non-audio events.
 */
export const VOICE_LIVE_DATA_CHANNEL = 'voice-live-events';

/**
 * Default timeout for the control channel to open (ms). Guards against a socket that never
 * opens *and* never errors (silently dropped upgrade, dead proxy), which would otherwise leave
 * the hook in `'connecting'` forever. Set `connectTimeoutMs: 0` to disable.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 15000;
