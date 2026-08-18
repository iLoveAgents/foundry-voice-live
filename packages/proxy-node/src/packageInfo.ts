/**
 * Read name/version from this package's package.json at runtime.
 *
 * Works from both `src/` (tsx dev) and `dist/` (build, npm, Docker) because
 * `package.json` always sits one directory above the module.
 */

import { readFileSync } from "node:fs";

export interface PackageInfo {
  name: string;
  version: string;
}

export const PACKAGE_JSON_URL = new URL("../package.json", import.meta.url);

/**
 * Read `{ name, version }` from package.json. Falls back to `unknown` values
 * instead of throwing, so a packaging mistake never takes the server down.
 */
export function readPackageInfo(packageJsonUrl: URL = PACKAGE_JSON_URL): PackageInfo {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as Partial<PackageInfo>;
    return {
      name: typeof parsed.name === "string" ? parsed.name : "unknown",
      version: typeof parsed.version === "string" ? parsed.version : "unknown",
    };
  } catch {
    return { name: "unknown", version: "unknown" };
  }
}
