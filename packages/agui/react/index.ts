/**
 * React glue for the Voice Live → AG-UI bridge.
 *
 * `useVoiceLiveAgent` builds the agent you register with CopilotKit; `useVoiceLiveAgentBinding`
 * runs the Voice Live session and streams it into that agent. Requires `react` and
 * `@iloveagents/foundry-voice-live-react` as peer dependencies.
 */
export { useVoiceLiveAgent } from './useVoiceLiveAgent';
export { useVoiceLiveAgentBinding } from './useVoiceLiveAgentBinding';
export type { UseVoiceLiveAgentBindingOptions } from './useVoiceLiveAgentBinding';
export { VoiceLiveAgent } from '../agent';
export type { VoiceLiveAgentOptions, VoiceSessionBridge } from '../agent';
