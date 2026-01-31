/**
 * useToolExecution Hook
 *
 * Custom React hook for handling AI tool/function calling execution.
 * This hook provides a clean interface for executing tools and sending responses back to the AI.
 *
 * Usage:
 * ```typescript
 * const { executeTool } = useToolExecution(sendEvent, modalController);
 *
 * // In your WebSocket message handler:
 * if (data.type === "response.function_call_arguments.done") {
 *   executeTool(data.name, data.arguments, data.call_id);
 * }
 * ```
 */

import { useCallback } from "react";
import { toolHandlers, ModalController, ToolResult } from "./toolHandlers";

/**
 * Voice Live API Event Sender
 * Function to send events to the Voice Live API WebSocket
 */
export type EventSender = (event: Record<string, unknown>) => void;

/**
 * Tool Execution Hook
 */
export function useToolExecution(
  sendEvent: EventSender,
  modalController: ModalController
) {
  /**
   * Execute a tool and send the result back to the AI
   *
   * @param toolName - Name of the tool to execute
   * @param argsJson - JSON string of tool arguments
   * @param callId - Call ID from the Voice Live API
   */
  const executeTool = useCallback(
    (toolName: string, argsJson: string, callId: string) => {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] 🔧 Executing tool: ${toolName}`);

      try {
        // Parse arguments
        const args = JSON.parse(argsJson);
        console.log(`[${timestamp}] 📋 Tool arguments:`, args);

        // Get tool handler
        const handler = toolHandlers[toolName];
        if (!handler) {
          throw new Error(`Unknown tool: ${toolName}`);
        }

        // Execute tool
        const result: ToolResult = handler(args, modalController);
        console.log(`[${timestamp}] ✅ Tool executed successfully:`, result);

        // Send success response back to AI
        sendEvent({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify(result),
          },
        });

        // Trigger AI response generation
        sendEvent({
          type: "response.create",
        });
      } catch (error) {
        console.error(`[${timestamp}] ❌ Tool execution error:`, error);

        // Send error response back to AI
        const errorMessage =
          error instanceof Error ? error.message : "Tool execution failed";

        sendEvent({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({ error: errorMessage }),
          },
        });

        // Trigger AI response generation
        sendEvent({
          type: "response.create",
        });
      }
    },
    [sendEvent, modalController]
  );

  return { executeTool };
}
