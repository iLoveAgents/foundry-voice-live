/**
 * Tool Definitions for Azure AI Foundry Voice Live API
 *
 * This file defines the tools (functions) available to the AI assistant.
 * These tools allow the AI to interact with the UI and query the DOM.
 *
 * Tool Definition Structure:
 * - type: Always "function" for function calling
 * - name: Unique identifier for the tool
 * - description: Clear description of what the tool does (helps the AI decide when to use it)
 * - parameters: JSON Schema defining the function parameters
 */

export interface ToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Show Modal Tool
 * Displays content to the user in a modal/drawer panel
 */
export const showModalTool: ToolDefinition = {
  type: "function",
  name: "show_modal",
  description:
    "Display content to the user in a drawer panel. Use this to show detailed information, diagrams, or formatted text. Supports plain text, markdown, and mermaid diagrams.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "The title of the drawer panel",
      },
      content: {
        type: "string",
        description:
          "The content to display. For mermaid diagrams, provide the raw mermaid syntax (you can include ```mermaid wrappers if needed, they will be stripped automatically). Examples: 'graph TD\\n    A-->B', 'flowchart LR\\n    Start-->End'",
      },
      contentType: {
        type: "string",
        enum: ["text", "markdown", "mermaid"],
        description:
          "The type of content: 'text' for plain text, 'markdown' for formatted markdown, 'mermaid' for diagrams (flowchart, sequence, class, etc.)",
      },
      size: {
        type: "string",
        enum: ["small", "medium", "large", "full"],
        description:
          "The size of the drawer: 'small' (320px), 'medium' (592px), 'large' (940px), 'full' (100% width). Default is 'large'.",
      },
    },
    required: ["title", "content", "contentType"],
  },
};

/**
 * Query DOM Tool
 * Queries the DOM to get information about elements on the page
 */
export const queryDomTool: ToolDefinition = {
  type: "function",
  name: "query_dom",
  description:
    "Query the DOM to get information about elements on the page. Use this to check what's currently displayed or to interact with the page.",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description:
          "CSS selector to find elements (e.g., 'canvas', '.avatar', '#status')",
      },
      action: {
        type: "string",
        enum: ["getText", "getAttribute", "getCount", "exists"],
        description:
          "Action to perform: 'getText' to get text content, 'getAttribute' to get an attribute value, 'getCount' to count matching elements, 'exists' to check if element exists",
      },
      attributeName: {
        type: "string",
        description:
          "Required when action is 'getAttribute'. The name of the attribute to get.",
      },
    },
    required: ["selector", "action"],
  },
};

/**
 * Close Modal Tool
 * Closes the currently open modal/drawer
 */
export const closeModalTool: ToolDefinition = {
  type: "function",
  name: "close_modal",
  description:
    "Close the currently open modal/drawer. Use this when the user asks to close it or when you're done showing information.",
  parameters: {
    type: "object",
    properties: {},
  },
};

/**
 * Tool Registry
 * Array of all available tools to register with the AI assistant
 */
export const toolRegistry: ToolDefinition[] = [
  showModalTool,
  queryDomTool,
  closeModalTool,
];
