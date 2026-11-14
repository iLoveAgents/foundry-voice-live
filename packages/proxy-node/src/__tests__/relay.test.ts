import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { relayWebSocket } from "../relay.js";
import type { AzureConnectionConfig } from "../types.js";

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  });
  terminate = vi.fn(() => {
    this.readyState = WebSocket.CLOSED;
    this.emit("error", new Error("handshake terminated"));
    this.emit("close");
  });
  asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }
}

const connection: AzureConnectionConfig = {
  url: "wss://test.services.ai.azure.com/voice-live/realtime/calls",
  protocols: ["realtime"],
  headers: { "api-key": "server-key" },
};

function deferredConnection(): {
  promise: Promise<AzureConnectionConfig>;
  resolve: (value: AzureConnectionConfig) => void;
} {
  let resolve!: (value: AzureConnectionConfig) => void;
  const promise = new Promise<AzureConnectionConfig>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(): {
  client: FakeSocket;
  upstream: FakeSocket;
  createSocket: ReturnType<typeof vi.fn<(config: AzureConnectionConfig) => WebSocket>>;
} {
  const client = new FakeSocket();
  const upstream = new FakeSocket();
  upstream.readyState = WebSocket.CONNECTING;
  const createSocket = vi.fn<(config: AzureConnectionConfig) => WebSocket>(() =>
    upstream.asWebSocket()
  );
  return { client, upstream, createSocket };
}

describe("persistent Voice Live signaling relay", () => {
  it("retains early SDP and session events across token acquisition and handshake", async () => {
    const { client, upstream, createSocket } = setup();
    const auth = deferredConnection();
    const onOpen = vi.fn();
    const task = relayWebSocket(client.asWebSocket(), () => auth.promise, { createSocket, onOpen });
    const offer = JSON.stringify({ type: "rtc.call.sdp.create", sdp_offer: "v=0\r\n" });
    const update = JSON.stringify({ type: "session.update", session: { instructions: "Hello" } });
    client.emit("message", Buffer.from(offer));
    auth.resolve(connection);
    await task;
    client.emit("message", Buffer.from(update));
    expect(upstream.send).not.toHaveBeenCalled();
    expect(createSocket).toHaveBeenCalledWith(connection);
    upstream.readyState = WebSocket.OPEN;
    upstream.emit("open");
    expect(upstream.send.mock.calls).toEqual([[offer], [update]]);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("keeps forwarding answers, session changes and tool calls after negotiation", async () => {
    const { client, upstream, createSocket } = setup();
    await relayWebSocket(client.asWebSocket(), async () => connection, { createSocket });
    upstream.readyState = WebSocket.OPEN;
    upstream.emit("open");
    const answer = JSON.stringify({ type: "rtc.call.sdp.created", sdp_answer: "v=0\r\n" });
    const tool = JSON.stringify({
      type: "response.function_call_arguments.done",
      call_id: "call_1",
    });
    const result = JSON.stringify({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: "call_1", output: "ok" },
    });
    const update = JSON.stringify({ type: "session.update", session: { instructions: "Updated" } });
    upstream.emit("message", Buffer.from(answer));
    upstream.emit("message", Buffer.from(tool));
    client.emit("message", Buffer.from(result));
    client.emit("message", Buffer.from(update));
    expect(client.send.mock.calls).toEqual([[answer], [tool]]);
    expect(upstream.send.mock.calls).toEqual([[result], [update]]);
    expect(client.close).not.toHaveBeenCalled();
    expect(upstream.close).not.toHaveBeenCalled();
  });

  it("does not open an orphan Azure connection when the browser closes during auth", async () => {
    const { client, createSocket } = setup();
    const auth = deferredConnection();
    const onClose = vi.fn();
    const task = relayWebSocket(client.asWebSocket(), () => auth.promise, {
      createSocket,
      onClose,
    });
    client.close();
    auth.resolve(connection);
    await task;
    expect(createSocket).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("terminates an unfinished handshake and releases capacity exactly once", async () => {
    const { client, upstream, createSocket } = setup();
    const onClose = vi.fn();
    const onError = vi.fn();
    await relayWebSocket(client.asWebSocket(), async () => connection, {
      createSocket,
      onClose,
      onError,
    });
    client.emit("error", new Error("client failed"));
    client.emit("close");
    expect(upstream.terminate).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("closes the Azure control channel when the browser disconnects after negotiation", async () => {
    const { client, upstream, createSocket } = setup();
    const onClose = vi.fn();
    await relayWebSocket(client.asWebSocket(), async () => connection, { createSocket, onClose });
    upstream.readyState = WebSocket.OPEN;
    upstream.emit("open");
    client.close();
    expect(upstream.close).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes the browser if Azure rejects or closes a handshake", async () => {
    const { client, upstream, createSocket } = setup();
    const onClose = vi.fn();
    await relayWebSocket(client.asWebSocket(), async () => connection, { createSocket, onClose });
    upstream.close();
    expect(client.close).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("bounds pre-connect buffering and does not acquire a late upstream socket", async () => {
    const { client, createSocket } = setup();
    const auth = deferredConnection();
    const onError = vi.fn();
    const task = relayWebSocket(client.asWebSocket(), () => auth.promise, {
      createSocket,
      onError,
      maxPendingBytes: 8,
    });
    client.emit("message", Buffer.from("too much data"));
    auth.resolve(connection);
    await task;
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("buffer limit") })
    );
    expect(client.close).toHaveBeenCalledOnce();
    expect(createSocket).not.toHaveBeenCalled();
  });

  it("reports authentication failure and releases capacity once", async () => {
    const { client, createSocket } = setup();
    const onClose = vi.fn();
    await relayWebSocket(
      client.asWebSocket(),
      async () => {
        throw new Error("No credential");
      },
      { createSocket, onClose }
    );
    expect(JSON.parse(client.send.mock.calls[0]![0]).error.message).toBe("No credential");
    expect(client.close).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(createSocket).not.toHaveBeenCalled();
  });
});
