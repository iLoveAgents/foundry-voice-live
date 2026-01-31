/**
 * Tool System for Azure AI Foundry Voice Live API
 *
 * This module provides a clean, modular architecture for implementing
 * AI function calling (tools) with Azure AI Foundry Voice Live API.
 *
 * Components:
 * - toolRegistry: Array of tool definitions to register with the AI
 * - toolHandlers: Implementation of each tool
 * - useToolExecution: React hook for executing tools
 * - ModalController: Interface for UI interaction
 *
 * Quick Start:
 * ```typescript
 * import { toolRegistry, useToolExecution } from './tools';
 *
 * // 1. Register tools in session.update
 * sendEvent({
 *   type: "session.update",
 *   session: {
 *     tools: toolRegistry,
 *     // ... other config
 *   }
 * });
 *
 * // 2. Use the hook to handle tool execution
 * const { executeTool } = useToolExecution(sendEvent, modalController);
 *
 * // 3. Execute tools in WebSocket message handler
 * if (data.type === "response.function_call_arguments.done") {
 *   executeTool(data.name, data.arguments, data.call_id);
 * }
 * ```
 */

export { toolRegistry } from "./toolDefinitions";
export type { ToolDefinition } from "./toolDefinitions";

export { toolHandlers } from "./toolHandlers";
export type { ModalController, ToolResult, ToolHandler } from "./toolHandlers";

export { useToolExecution } from "./useToolExecution";
export type { EventSender } from "./useToolExecution";
