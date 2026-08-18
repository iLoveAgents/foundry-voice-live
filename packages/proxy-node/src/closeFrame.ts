/**
 * Translating an upstream close into one the browser can be told about.
 *
 * The SDK decides whether to reconnect from the close code, so the upstream's own code has to
 * survive the hop: closing the browser socket without a code produces `1005 (no status)`, which is
 * indistinguishable from an abnormal end and makes clients retry after a *normal* shutdown.
 * Some codes may never appear in a close frame, so those are mapped to the nearest honest
 * equivalent instead of being forwarded.
 */

/** Codes that are status placeholders and cannot be sent in a frame (RFC 6455 §7.4.1) */
const NON_TRANSMITTABLE = new Set([1005, 1006, 1015]);

/** Reserved range that must not be sent by an endpoint */
const isValidCloseCode = (code: number): boolean =>
  (code >= 1000 && code <= 1014 && !NON_TRANSMITTABLE.has(code)) || (code >= 3000 && code <= 4999);

/** Close reasons are limited to 123 bytes in a close frame */
const MAX_REASON_BYTES = 123;

export interface ClientCloseFrame {
  code: number;
  reason: string;
}

/**
 * @param upstreamCode - close code reported by the Azure socket
 * @param upstreamReason - close reason reported by the Azure socket
 */
export function toClientCloseFrame(upstreamCode: number, upstreamReason = ""): ClientCloseFrame {
  const code = isValidCloseCode(upstreamCode) ? upstreamCode : 1011;
  let reason = upstreamReason;
  if (Buffer.byteLength(reason, "utf8") > MAX_REASON_BYTES) {
    // Truncate on a byte boundary that is still valid UTF-8
    reason = Buffer.from(reason, "utf8").subarray(0, MAX_REASON_BYTES).toString("utf8");
    // A cut multi-byte sequence decodes to U+FFFD; drop it so the reason stays clean
    reason = reason.replace(/�+$/, "");
  }
  if (!isValidCloseCode(upstreamCode) && !reason) {
    reason = `Upstream closed (${upstreamCode})`;
  }
  return { code, reason };
}

/**
 * Close code for a connection that failed before the relay was established.
 *
 * The distinction matters to the browser: `1008` says "your request was wrong, retrying it
 * unchanged will fail again", while `1011` says "the proxy or upstream failed, a retry may
 * work". Closing without a code at all would arrive as `1005 "no status"`, which an SDK client
 * with reconnect enabled cannot tell apart from a network drop.
 */
export function connectFailureCloseFrame(isClientRequestError: boolean): ClientCloseFrame {
  return isClientRequestError
    ? { code: 1008, reason: "Invalid connection request" }
    : { code: 1011, reason: "Upstream connection failed" };
}

/**
 * Capacity rejection. `1013 Try Again Later` is deliberate: the SDK stops reconnecting on `1008`
 * (a request that would be rejected identically), but capacity frees up on its own.
 */
export const SERVER_AT_CAPACITY_CLOSE: ClientCloseFrame = {
  code: 1013,
  reason: "Server at capacity",
};
