/**
 * Origin checking for HTTP requests and WebSocket upgrades.
 *
 * The proxy holds the Azure credentials, so the browser `Origin` is the only thing that keeps a
 * random web page from opening sessions on your resource. Note that non-browser clients (curl,
 * native apps, scripts) send no `Origin` at all and therefore bypass this check by design —
 * protect the proxy with network rules or your own auth if that matters (see README).
 */

/** Normalize an origin for comparison: lowercase scheme+host, no trailing slash, no path */
function normalizeOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    // `url.origin` is already normalized (scheme + host + explicit non-default port)
    return url.origin.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * Whether a request origin is allowed.
 *
 * Matching is **exact** on the normalized origin. A prefix comparison would let
 * `http://localhost:3001.attacker.com` pass a `http://localhost:3001` allow-list.
 *
 * @param origin - the request's `Origin` header (undefined for non-browser clients)
 * @param allowed - configured origins; `"*"` allows every origin
 */
export function isOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  // No Origin header: not a browser request, so there is no cross-site risk to block here
  if (!origin) return true;
  if (allowed.includes("*")) return true;
  const candidate = normalizeOrigin(origin);
  return allowed.some((entry) => normalizeOrigin(entry) === candidate);
}

/**
 * Read a positive-integer setting from the environment.
 *
 * `parseInt("unlimited")` is `NaN`, and `NaN` silently *removes* a limit rather than enforcing it:
 * `active >= NaN` is always false, and `ws` turns `maxPayload: NaN` into "no cap". A bad value
 * must therefore fall back to the default, loudly, instead of disabling the protection it configures.
 */
export function readPositiveInt(
  raw: string | undefined,
  fallback: number,
  name: string,
  warn: (message: string) => void = (): void => undefined
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    warn(`[Config] ${name}="${raw}" is not a positive integer — using ${fallback}`);
    return fallback;
  }
  return value;
}
