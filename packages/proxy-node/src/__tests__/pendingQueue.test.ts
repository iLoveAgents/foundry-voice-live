import { describe, it, expect } from "vitest";
import {
  PendingMessageQueue,
  DEFAULT_MAX_PENDING_MESSAGES,
  DEFAULT_MAX_PENDING_BYTES,
} from "../pendingQueue.js";

describe("PendingMessageQueue", () => {
  it("queues and drains in order, resetting the byte counter", () => {
    const queue = new PendingMessageQueue();
    expect(queue.size).toBe(0);
    expect(queue.push('{"type":"session.update"}')).toBe("queued");
    expect(queue.push('{"type":"rtc.call.sdp.create"}')).toBe("queued");
    expect(queue.size).toBe(2);
    expect(queue.byteLength).toBe(
      '{"type":"session.update"}'.length + '{"type":"rtc.call.sdp.create"}'.length
    );

    expect(queue.drain()).toEqual(['{"type":"session.update"}', '{"type":"rtc.call.sdp.create"}']);
    expect(queue.size).toBe(0);
    expect(queue.byteLength).toBe(0);
    expect(queue.drain()).toEqual([]);
  });

  it("drops further frames once the frame count is reached (connection stays up)", () => {
    const queue = new PendingMessageQueue({ maxMessages: 2 });
    expect(queue.push("a")).toBe("queued");
    expect(queue.push("b")).toBe("queued");
    expect(queue.push("c")).toBe("dropped");
    expect(queue.size).toBe(2);
    expect(queue.drain()).toEqual(["a", "b"]);
    // capacity is reusable after a flush
    expect(queue.push("d")).toBe("queued");
  });

  it("reports over-budget instead of retaining oversized payloads (memory exhaustion guard)", () => {
    const queue = new PendingMessageQueue({ maxBytes: 100 });
    expect(queue.push("x".repeat(60))).toBe("queued");
    // one frame that would exceed the cumulative budget is rejected, not truncated or queued
    expect(queue.push("y".repeat(41))).toBe("over-budget");
    expect(queue.size).toBe(1);
    expect(queue.byteLength).toBe(60);
    // a single huge frame is rejected too, even on an empty queue
    const fresh = new PendingMessageQueue({ maxBytes: 100 });
    expect(fresh.push("z".repeat(101))).toBe("over-budget");
    expect(fresh.size).toBe(0);
  });

  it("counts UTF-8 bytes rather than UTF-16 code units", () => {
    const queue = new PendingMessageQueue({ maxBytes: 10 });
    // 4 emoji = 16 UTF-8 bytes (8 UTF-16 code units) → must not fit into 10 bytes
    expect(queue.push("😀😀😀😀")).toBe("over-budget");
    const single = new PendingMessageQueue({ maxBytes: 10 });
    expect(single.push("😀😀")).toBe("queued");
    expect(single.byteLength).toBe(8);
  });

  it("has generous defaults for a real handshake but bounds an abusive client", () => {
    const queue = new PendingMessageQueue();
    expect(queue.maxMessages).toBe(DEFAULT_MAX_PENDING_MESSAGES);
    expect(queue.maxBytes).toBe(DEFAULT_MAX_PENDING_BYTES);
    // a typical pre-connect handshake fits comfortably
    expect(queue.push("s".repeat(4096))).toBe("queued");
    // 256 frames of ws's default 100 MB maxPayload would be gigabytes — rejected at 1 MiB
    expect(queue.push("s".repeat(DEFAULT_MAX_PENDING_BYTES))).toBe("over-budget");
  });
});
