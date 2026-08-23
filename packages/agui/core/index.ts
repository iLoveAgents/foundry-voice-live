/**
 * Framework-agnostic core of the Voice Live → AG-UI bridge.
 *
 * Pure, React-free, rxjs-free — importable in bare Node. This is the layer the unit tests and the
 * `doctor` build on. The React glue lives in `../react`, the AbstractAgent in `../agent`.
 */
export { VoiceLiveAguiMapper } from './mapper';
export { RunPolicy } from './runPolicy';
export type { RunPolicyDecision } from './runPolicy';
export {
  messageIdFor,
  toolCallIdFor,
  toolResultMessageId,
  sequentialIds,
  type IdSource,
} from './ids';
export { initialVoiceState, patchVoiceState, toAguiState, type JsonPatchOp } from './voiceState';
export { VOICE_CUSTOM_EVENTS } from './customEvents';
export type { VoiceCustomEventName, VoiceCustomPayloads } from './customEvents';
export type {
  MapperOutput,
  MapperSnapshot,
  HostEvent,
  VoiceState,
  RunClosedReason,
  VoiceLiveAguiMapperOptions,
} from './types';
