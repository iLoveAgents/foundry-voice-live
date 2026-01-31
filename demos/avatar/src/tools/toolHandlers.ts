/**
 * Tool Handlers for Azure AI Foundry Voice Live API
 *
 * This file contains the actual implementation of each tool.
 * Each handler receives parsed arguments and returns a result or throws an error.
 *
 * Handler Pattern:
 * - Receives strongly-typed arguments
 * - Performs the requested action
 * - Returns a result object or throws an error
 * - Errors are automatically caught and sent back to the AI
 */

/**
 * Modal Control Interface
 * Used to show/hide modals from tool handlers
 */
export interface ModalController {
  showModal: (
    title: string,
    content: string,
    contentType: "text" | "markdown" | "mermaid",
    size?: "small" | "medium" | "large" | "full"
  ) => void;
  closeModal: () => void;
}

/**
 * Tool Handler Result
 * Standard return type for all tool handlers
 */
export interface ToolResult {
  success?: boolean;
  result?: any;
  error?: string;
}

/**
 * Show Modal Handler
 * Displays content in a drawer panel
 */
export function handleShowModal(
  args: {
    title: string;
    content: string;
    contentType: "text" | "markdown" | "mermaid";
    size?: "small" | "medium" | "large" | "full";
  },
  modalController: ModalController
): ToolResult {
  let content = args.content;

  // Clean mermaid content if it's wrapped in code fences
  if (args.contentType === "mermaid") {
    content = content
      .replace(/^```mermaid\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
  }

  modalController.showModal(
    args.title,
    content,
    args.contentType,
    args.size || "large"
  );

  return { success: true };
}

/**
 * Query DOM Handler
 * Queries the DOM to get information about elements
 */
export function handleQueryDom(args: {
  selector: string;
  action: "getText" | "getAttribute" | "getCount" | "exists";
  attributeName?: string;
}): ToolResult {
  let result: any = null;

  switch (args.action) {
    case "getText":
      const textElement = document.querySelector(args.selector);
      result = textElement ? textElement.textContent?.trim() : null;
      break;

    case "getAttribute":
      if (!args.attributeName) {
        throw new Error("attributeName is required for getAttribute action");
      }
      const attrElement = document.querySelector(args.selector);
      result = attrElement
        ? attrElement.getAttribute(args.attributeName)
        : null;
      break;

    case "getCount":
      result = document.querySelectorAll(args.selector).length;
      break;

    case "exists":
      result = document.querySelector(args.selector) !== null;
      break;

    default:
      throw new Error(`Unknown action: ${args.action}`);
  }

  return { result };
}

/**
 * Close Modal Handler
 * Closes the currently open modal/drawer
 */
export function handleCloseModal(
  _args: Record<string, never>,
  modalController: ModalController
): ToolResult {
  modalController.closeModal();
  return { success: true };
}

/**
 * Tool Handler Registry
 * Maps tool names to their handler functions
 */
export type ToolHandler = (
  args: any,
  modalController: ModalController
) => ToolResult;

export const toolHandlers: Record<string, ToolHandler> = {
  show_modal: handleShowModal,
  query_dom: handleQueryDom,
  close_modal: handleCloseModal,
};
