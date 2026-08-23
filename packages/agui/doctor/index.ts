/**
 * The AG-UI doctor: probe an endpoint, get a feature + voice-readiness report. Runs in Node ≥18 and
 * in the browser (global `fetch`). The proxy calls `probeEndpoint` at startup; CI calls it against
 * the demo backends; the CLI (`./cli`) wraps it for developers.
 */
export { probeEndpoint } from './probe';
export type { ProbeOptions, DoctorReport, RunObservation, VoiceVerdict } from './probe';
export { formatReport } from './format';
export type { FormatOptions } from './format';
