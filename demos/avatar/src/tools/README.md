# AI Function Calling (Tools) System

This directory contains a modular, reusable architecture for implementing AI function calling with **Azure AI Foundry Voice Live API**. It demonstrates best practices for enabling AI assistants to interact with your application through tools/functions.

## 📁 Directory Structure

```
tools/
├── README.md                  # This file - documentation
├── index.ts                   # Public API exports
├── toolDefinitions.ts         # Tool schemas for the AI
├── toolHandlers.ts            # Implementation of each tool
└── useToolExecution.ts        # React hook for tool execution
```

## 🎯 What is Function Calling?

Function calling (also called "tools") allows AI assistants to:
- Execute code in your application
- Query data or state
- Modify UI components
- Interact with external systems

The AI decides **when** to call functions based on the conversation context, and you provide the **implementation**.

## 🏗️ Architecture Overview

### 1. **Tool Definitions** (`toolDefinitions.ts`)

Defines the **schema** of tools available to the AI. Each tool includes:
- **name**: Unique identifier (e.g., `show_modal`)
- **description**: Helps the AI decide when to use this tool
- **parameters**: JSON Schema defining function arguments

```typescript
export const showModalTool: ToolDefinition = {
  type: "function",
  name: "show_modal",
  description: "Display content to the user in a drawer panel...",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "..." },
      content: { type: "string", description: "..." },
      contentType: { type: "string", enum: ["text", "markdown", "mermaid"] }
    },
    required: ["title", "content", "contentType"]
  }
};

export const toolRegistry: ToolDefinition[] = [
  showModalTool,
  queryDomTool,
  closeModalTool
];
```

### 2. **Tool Handlers** (`toolHandlers.ts`)

Implements the **logic** for each tool. Handlers:
- Receive parsed arguments
- Execute the requested action
- Return results or throw errors

```typescript
export function handleShowModal(
  args: { title: string; content: string; contentType: string },
  modalController: ModalController
): ToolResult {
  // Clean up content (e.g., strip markdown fences)
  let content = args.content;
  if (args.contentType === "mermaid") {
    content = content.replace(/^```mermaid\s*/i, "").replace(/\s*```\s*$/, "").trim();
  }

  // Execute the action
  modalController.showModal(args.title, content, args.contentType);

  return { success: true };
}
```

### 3. **Tool Execution Hook** (`useToolExecution.ts`)

React hook that orchestrates tool execution:
- Parses AI function call arguments
- Dispatches to the correct handler
- Sends results back to the AI
- Handles errors gracefully

```typescript
export function useToolExecution(
  sendEvent: EventSender,
  modalController: ModalController
) {
  const executeTool = useCallback(
    (toolName: string, argsJson: string, callId: string) => {
      try {
        const args = JSON.parse(argsJson);
        const handler = toolHandlers[toolName];
        const result = handler(args, modalController);

        // Send result back to AI
        sendEvent({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: callId, output: JSON.stringify(result) }
        });
        sendEvent({ type: "response.create" });
      } catch (error) {
        // Send error back to AI
        sendEvent({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: callId, output: JSON.stringify({ error: error.message }) }
        });
        sendEvent({ type: "response.create" });
      }
    },
    [sendEvent, modalController]
  );

  return { executeTool };
}
```

## 🚀 Quick Start

### Step 1: Register Tools with AI

In your WebSocket session configuration:

```typescript
import { toolRegistry } from './tools';

sendEvent({
  type: "session.update",
  session: {
    modalities: ["text", "audio"],
    tools: toolRegistry,  // ← Register all tools
    // ... other config
  }
});
```

### Step 2: Create Modal Controller

Define how tools interact with your UI:

```typescript
import { ModalController } from './tools';

const modalController: ModalController = useMemo(
  () => ({
    showModal: (title, content, contentType, size) => {
      setModalTitle(title);
      setModalContent(content);
      setModalContentType(contentType);
      setModalSize(size || "large");
      setModalOpen(true);
    },
    closeModal: () => {
      setModalOpen(false);
    },
  }),
  []
);
```

### Step 3: Use Tool Execution Hook

```typescript
import { useToolExecution } from './tools';

const { executeTool } = useToolExecution(sendEvent, modalController);
```

### Step 4: Handle Function Calls

In your WebSocket message handler:

```typescript
ws.onmessage = async (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case "response.function_call_arguments.done":
      // Execute tool using the modular system
      executeTool(data.name, data.arguments, data.call_id);
      break;

    // ... other event handlers
  }
};
```

## 🔧 Adding New Tools

### 1. Define the Tool

Add to `toolDefinitions.ts`:

```typescript
export const myNewTool: ToolDefinition = {
  type: "function",
  name: "my_new_tool",
  description: "What this tool does and when to use it",
  parameters: {
    type: "object",
    properties: {
      param1: { type: "string", description: "..." },
      param2: { type: "number", description: "..." }
    },
    required: ["param1"]
  }
};

// Add to registry
export const toolRegistry: ToolDefinition[] = [
  showModalTool,
  queryDomTool,
  closeModalTool,
  myNewTool  // ← Add here
];
```

### 2. Implement the Handler

Add to `toolHandlers.ts`:

```typescript
export function handleMyNewTool(
  args: { param1: string; param2?: number },
  modalController: ModalController
): ToolResult {
  // Your implementation
  console.log("Executing myNewTool with:", args);

  // Perform actions
  const result = doSomething(args.param1, args.param2);

  return { result };
}

// Register handler
export const toolHandlers: Record<string, ToolHandler> = {
  show_modal: handleShowModal,
  query_dom: handleQueryDom,
  close_modal: handleCloseModal,
  my_new_tool: handleMyNewTool  // ← Add here
};
```

### 3. Update Controller (if needed)

If your tool needs UI interaction, extend `ModalController`:

```typescript
export interface ModalController {
  showModal: (...) => void;
  closeModal: () => void;
  myNewAction: () => void;  // ← Add new action
}
```

That's it! The AI can now call your new tool.

## 📚 Available Tools

### `show_modal`
Displays content in a drawer panel. Supports:
- **Plain text**
- **Markdown** (with syntax highlighting)
- **Mermaid diagrams** (flowcharts, sequence diagrams, etc.)

**Example AI usage:**
> "Let me show you a diagram of the architecture..."

### `query_dom`
Queries the DOM to inspect page elements:
- `getText`: Get element text content
- `getAttribute`: Get element attribute value
- `getCount`: Count matching elements
- `exists`: Check if element exists

**Example AI usage:**
> "Let me check what's on the page right now..."

### `close_modal`
Closes the currently open modal/drawer.

**Example AI usage:**
> "I'll close this for you..."

## 🎨 Design Patterns

### Separation of Concerns
- **Definitions**: What tools exist (schema)
- **Handlers**: What tools do (logic)
- **Hook**: How tools are executed (orchestration)

### Error Handling
All errors are caught and sent back to the AI, allowing it to respond gracefully:

```typescript
// Handler throws error
throw new Error("Invalid selector");

// AI receives error and can say:
"I'm sorry, that selector didn't work. Could you try a different one?"
```

### Type Safety
TypeScript interfaces ensure compile-time safety:

```typescript
export interface ToolResult {
  success?: boolean;
  result?: any;
  error?: string;
}
```

## 🧪 Testing Tools

Test individual handlers without the AI:

```typescript
import { handleShowModal } from './tools/toolHandlers';

const mockController = {
  showModal: (title, content, contentType) => {
    console.log(`Modal: ${title}`, content);
  },
  closeModal: () => {}
};

const result = handleShowModal(
  { title: "Test", content: "Hello", contentType: "text" },
  mockController
);

console.log(result); // { success: true }
```

## 📖 Learn More

- [Azure AI Foundry Voice Live API Documentation](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/realtime-audio)
- [OpenAI Realtime API - Function Calling](https://platform.openai.com/docs/guides/realtime)
- [JSON Schema](https://json-schema.org/) for parameter definitions

## 🤝 Contributing

When adding tools, ensure:
1. **Clear descriptions** - Help the AI understand when to use the tool
2. **Strong typing** - Use TypeScript interfaces for arguments
3. **Error handling** - Throw descriptive errors
4. **Documentation** - Update this README with new tools

---

**Built by [iLoveAgents.ai](https://iLoveAgents.ai)** - AI Agents Experts
