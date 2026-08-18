/**
 * Proactive greeting ("assistant speaks first") event builder.
 *
 * Wire format verified against the official `@azure/ai-voicelive` SDK:
 * - LLM greeting: a system message item + `response.create`
 * - Pre-generated greeting: `response.create` with
 *   `response.pre_generated_assistant_message` (content part type `text`)
 *
 * @see https://learn.microsoft.com/azure/ai-services/speech-service/how-to-voice-live-proactive-messages
 */

import type { GreetingConfig } from '../types/voiceLive';
import type { VoiceLiveClientEvent } from '../types/events';

/**
 * Build the client events that trigger a proactive greeting.
 *
 * @param greeting - Greeting configuration
 * @param now - Timestamp used for the `event_id` (injectable for tests)
 * @returns Events to send, in order
 */
export function buildGreetingEvents(greeting: GreetingConfig, now: number = Date.now()): VoiceLiveClientEvent[] {
  if (greeting.type === 'llm') {
    return [
      {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text: greeting.text }],
        },
      },
      {
        type: 'response.create',
        event_id: `evt_llmgreeting_${now}`,
      },
    ];
  }

  return [
    {
      type: 'response.create',
      event_id: `evt_greeting_${now}`,
      response: {
        pre_generated_assistant_message: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: greeting.text }],
        },
      },
    },
  ];
}
