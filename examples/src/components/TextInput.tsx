import { useState } from 'react';
import { Section } from './Section';

interface TextInputProps {
  /** Called with the trimmed text when the user submits */
  onSend: (text: string) => void;
  /** Disable the form (e.g. while disconnected) */
  disabled?: boolean;
  title?: string;
  placeholder?: string;
}

/**
 * "Type instead of talk" — sends a user text message through `sendText()`.
 * Handy for demos without a microphone and for deterministic testing.
 */
export function TextInput({
  onSend,
  disabled = false,
  title = 'Type instead of talk',
  placeholder = 'Send a text message to the assistant…',
}: TextInputProps): JSX.Element {
  const [text, setText] = useState('');

  return (
    <Section title={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = text.trim();
          if (trimmed) {
            onSend(trimmed);
            setText('');
          }
        }}
        style={{ display: 'flex', gap: '0.5rem' }}
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          style={{ flex: 1, padding: '0.5rem' }}
        />
        <button type="submit" disabled={disabled || !text.trim()}>
          Send
        </button>
      </form>
    </Section>
  );
}
