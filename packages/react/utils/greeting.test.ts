import { describe, it, expect } from 'vitest';
import { buildGreetingEvents } from './greeting';

describe('buildGreetingEvents', () => {
  it('builds a system message + response.create for llm greetings', () => {
    const events = buildGreetingEvents({ type: 'llm', text: 'Greet the user warmly.' }, 123);

    expect(events).toEqual([
      {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text: 'Greet the user warmly.' }],
        },
      },
      { type: 'response.create', event_id: 'evt_llmgreeting_123' },
    ]);
  });

  it('builds response.create with pre_generated_assistant_message for pregenerated greetings', () => {
    const events = buildGreetingEvents({ type: 'pregenerated', text: 'Hello! How can I help?' }, 456);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'response.create',
      event_id: 'evt_greeting_456',
      response: {
        pre_generated_assistant_message: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello! How can I help?' }],
        },
      },
    });
  });

  it('never uses the legacy camelCase key or output_text part type', () => {
    const [event] = buildGreetingEvents({ type: 'pregenerated', text: 'x' });
    const json = JSON.stringify(event);
    expect(json).not.toContain('preGeneratedAssistantMessage');
    expect(json).not.toContain('output_text');
  });
});
