import { describe, it, expect } from "vitest";
import { connectFailureCloseFrame, SERVER_AT_CAPACITY_CLOSE, toClientCloseFrame } from "../closeFrame.js";

describe("toClientCloseFrame", () => {
  it("passes a normal upstream close through unchanged", () => {
    // The SDK must see 1000 to know this was intentional and NOT reconnect
    expect(toClientCloseFrame(1000, "")).toEqual({ code: 1000, reason: "" });
    expect(toClientCloseFrame(1000, "session complete")).toEqual({
      code: 1000,
      reason: "session complete",
    });
  });

  it("passes other transmittable codes through, including application codes", () => {
    expect(toClientCloseFrame(1001, "going away").code).toBe(1001);
    expect(toClientCloseFrame(1011, "server error").code).toBe(1011);
    expect(toClientCloseFrame(4008, "negotiation timeout").code).toBe(4008);
    expect(toClientCloseFrame(3000, "app specific").code).toBe(3000);
  });

  it("maps status placeholders that may not be sent in a frame", () => {
    // 1006 is what `ws` reports for an abnormal end; sending it would throw
    expect(toClientCloseFrame(1006, "")).toEqual({ code: 1011, reason: "Upstream closed (1006)" });
    expect(toClientCloseFrame(1005, "").code).toBe(1011);
    expect(toClientCloseFrame(1015, "").code).toBe(1011);
    // an out-of-range code is not forwarded either
    expect(toClientCloseFrame(2999, "").code).toBe(1011);
    expect(toClientCloseFrame(5000, "").code).toBe(1011);
  });

  it("keeps the upstream reason when it explains a mapped code", () => {
    expect(toClientCloseFrame(1006, "connection reset")).toEqual({
      code: 1011,
      reason: "connection reset",
    });
  });

  it("truncates reasons to the 123-byte close-frame limit", () => {
    const long = "x".repeat(200);
    const frame = toClientCloseFrame(1011, long);
    expect(Buffer.byteLength(frame.reason, "utf8")).toBeLessThanOrEqual(123);

    // multi-byte characters are not cut in half (that would be invalid UTF-8 on the wire)
    const emoji = "😀".repeat(50);
    const emojiFrame = toClientCloseFrame(1011, emoji);
    expect(Buffer.byteLength(emojiFrame.reason, "utf8")).toBeLessThanOrEqual(123);
    expect(emojiFrame.reason).not.toContain("�");
  });
});

describe("connectFailureCloseFrame", () => {
  it("tells the client its own request was wrong (1008) — retrying it unchanged cannot help", () => {
    expect(connectFailureCloseFrame(true)).toEqual({
      code: 1008,
      reason: "Invalid connection request",
    });
  });

  it("reports a proxy/upstream failure as 1011, which a client may retry", () => {
    expect(connectFailureCloseFrame(false)).toEqual({
      code: 1011,
      reason: "Upstream connection failed",
    });
  });

  it("never closes without a code (1005 is indistinguishable from a dropped connection)", () => {
    for (const isClientError of [true, false]) {
      const frame = connectFailureCloseFrame(isClientError);
      expect(frame.code).toBeGreaterThanOrEqual(1000);
      expect(frame.code).not.toBe(1005);
      expect(frame.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("close codes the proxy sends itself", () => {
  it("rejects on capacity with a code the client is allowed to retry", () => {
    // the SDK stops reconnecting on 1003/1008/1010 (a request that cannot succeed on retry);
    // capacity frees up, so it must not be one of those
    expect(SERVER_AT_CAPACITY_CLOSE.code).toBe(1013);
    expect([1003, 1008, 1010]).not.toContain(SERVER_AT_CAPACITY_CLOSE.code);
    expect(SERVER_AT_CAPACITY_CLOSE.reason).toBeTruthy();
  });
});
