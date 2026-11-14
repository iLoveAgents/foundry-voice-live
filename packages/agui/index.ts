/**
 * `@iloveagents/foundry-voice-live-agui` — bridge an Azure Voice Live session to the AG-UI protocol.
 *
 * Subpath entries keep the dependency graph honest:
 *   - `.`        re-exports the framework-agnostic core + the agent (no React).
 *   - `./core`   the pure mapper/run-policy/state (React- and rxjs-free consumers, tests, the doctor).
 *   - `./react`  the hooks (`react` + the Voice Live SDK as peers).
 *   - `./doctor` the endpoint conformance / voice-readiness probe (also the CLI bin).
 */
export * from './core';
export { VoiceLiveAgent } from './agent';
export type { VoiceLiveAgentOptions, VoiceSessionBridge } from './agent';
