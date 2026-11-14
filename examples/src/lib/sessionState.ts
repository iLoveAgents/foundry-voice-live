/** Display labels for `useVoiceLive`'s `sessionState` */
export const SESSION_STATE_LABELS: Record<string, string> = {
  idle: 'Idle',
  listening: 'Listening...',
  thinking: 'Thinking...',
  speaking: 'Speaking...',
};

/** Human-readable label for a session state; unknown states are shown as-is */
export function sessionStateLabel(state: string): string {
  return SESSION_STATE_LABELS[state] || state;
}
