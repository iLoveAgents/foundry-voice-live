import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PACKAGE_JSON_URL, readPackageInfo } from "../packageInfo.js";

describe("readPackageInfo", () => {
  it("reads name and version from the package.json one directory above the module", () => {
    // Same resolution the server uses at runtime (works from src/ and dist/ alike)
    const expected = JSON.parse(readFileSync(PACKAGE_JSON_URL, "utf8")) as {
      name: string;
      version: string;
    };
    const info = readPackageInfo();

    expect(info.name).toBe("@iloveagents/foundry-voice-live-proxy-node");
    expect(info.name).toBe(expected.name);
    expect(info.version).toBe(expected.version);
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("falls back to 'unknown' instead of throwing when package.json is unreadable", () => {
    const info = readPackageInfo(new URL("./does-not-exist/package.json", import.meta.url));
    expect(info).toEqual({ name: "unknown", version: "unknown" });
  });
});
