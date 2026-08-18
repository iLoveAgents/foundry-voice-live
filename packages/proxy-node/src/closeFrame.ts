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
