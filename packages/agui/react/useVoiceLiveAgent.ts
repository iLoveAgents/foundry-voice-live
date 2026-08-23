/**
 * `useVoiceLiveAgent` — create a stable `VoiceLiveAgent` for the lifetime of the component.
 *
 * The agent is the thing you hand to CopilotKit (`<CopilotKit agents={{ voice: agent }}>`), so it
 * must keep the same identity across renders — hence a ref, per this repo's rule that SDK instances
 * live in `useRef`, not `useState`. Options are read once, on first render; changing them later does
 * not recreate the agent (a voice agent is long-lived — you would remount to start a new thread).
 */

import { useRef } from 'react';
import { VoiceLiveAgent, type VoiceLiveAgentOptions } from '../agent';

export function useVoiceLiveAgent(options?: VoiceLiveAgentOptions): VoiceLiveAgent {
  const ref = useRef<VoiceLiveAgent | null>(null);
  if (ref.current === null) {
    ref.current = new VoiceLiveAgent(options);
  }
  return ref.current;
}
