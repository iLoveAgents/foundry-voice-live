import { Section } from './Section';
import type { TranscriptEntry } from '../lib/useTranscripts';

interface TranscriptPanelProps {
  transcripts: TranscriptEntry[];
  title?: string;
  /** CSS max-height of the scrolling list */
  maxHeight?: string;
}

/**
 * Scrolling transcript list: user turns in blue, assistant turns in green, partial
 * (non-final) entries dimmed. Renders nothing while there are no entries.
 */
export function TranscriptPanel({
  transcripts,
  title = 'Transcript',
  maxHeight = '300px',
}: TranscriptPanelProps): JSX.Element | null {
  if (transcripts.length === 0) return null;

  return (
    <Section title={title}>
      <div style={{ maxHeight, overflowY: 'auto' }}>
        {transcripts.map((entry, i) => (
          <p
            key={i}
            style={{
              color: entry.role === 'user' ? '#2196F3' : '#4CAF50',
              opacity: entry.isFinal ? 1 : 0.6,
              margin: '0.25rem 0',
            }}
          >
            <strong>{entry.role === 'user' ? 'You' : 'Assistant'}:</strong> {entry.text}
          </p>
        ))}
      </div>
    </Section>
  );
}
