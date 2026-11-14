import { useCallback, useState } from 'react';

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  isFinal: boolean;
}

export interface UseTranscriptsReturn {
  transcripts: TranscriptEntry[];
  /** Pass straight to `useVoiceLive({ onTranscript })` */
  onTranscript: (role: 'user' | 'assistant', text: string, isFinal: boolean) => void;
  /** Drop all entries (e.g. when a new conversation starts) */
  clear: () => void;
}

/**
 * Accumulates partial and final transcripts from `useVoiceLive`'s `onTranscript`.
 *
 * A new chunk replaces the last entry while that entry belongs to the same role and
 * is not final yet (streaming updates); otherwise it is appended as a new turn.
 */
export function useTranscripts(): UseTranscriptsReturn {
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  const onTranscript = useCallback(
    (role: 'user' | 'assistant', text: string, isFinal: boolean): void => {
      setTranscripts((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === role && !last.isFinal) {
          return [...prev.slice(0, -1), { role, text, isFinal }];
        }
        return [...prev, { role, text, isFinal }];
      });
    },
    []
  );

  const clear = useCallback((): void => {
    setTranscripts([]);
  }, []);

  return { transcripts, onTranscript, clear };
}
