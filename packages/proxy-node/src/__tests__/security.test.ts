import { describe, it, expect } from "vitest";
import { isOriginAllowed } from "../security.js";

const ALLOWED = ["http://localhost:3001", "https://app.example.com"];

describe("isOriginAllowed", () => {
  it("allows configured origins exactly", () => {
    expect(isOriginAllowed("http://localhost:3001", ALLOWED)).toBe(true);
    expect(isOriginAllowed("https://app.example.com", ALLOWED)).toBe(true);
  });

  it("rejects a prefix-extended origin (the classic allow-list bypass)", () => {
    // A `startsWith` check would let all of these through
    expect(isOriginAllowed("http://localhost:3001.attacker.com", ALLOWED)).toBe(false);
    expect(isOriginAllowed("https://app.example.com.attacker.com", ALLOWED)).toBe(false);
    expect(isOriginAllowed("https://app.example.compromised.net", ALLOWED)).toBe(false);
  });

  it("rejects other origins, ports and schemes", () => {
    expect(isOriginAllowed("http://evil.example", ALLOWED)).toBe(false);
    expect(isOriginAllowed("http://localhost:3002", ALLOWED)).toBe(false);
    expect(isOriginAllowed("https://localhost:3001", ALLOWED)).toBe(false);
  });

  it("normalizes trailing slashes and case", () => {
    expect(isOriginAllowed("http://LOCALHOST:3001", ALLOWED)).toBe(true);
    expect(isOriginAllowed("http://localhost:3001/", ALLOWED)).toBe(true);
    expect(isOriginAllowed("http://localhost:3001", ["http://localhost:3001/"])).toBe(true);
    // default ports are equivalent to their explicit form
    expect(isOriginAllowed("https://app.example.com:443", ALLOWED)).toBe(true);
  });

  it("honours the wildcard", () => {
    expect(isOriginAllowed("http://anything.example", ["*"])).toBe(true);
    expect(isOriginAllowed("http://anything.example", ["http://localhost:3001", "*"])).toBe(true);
  });

  it("allows requests without an Origin header (non-browser clients — documented)", () => {
    expect(isOriginAllowed(undefined, ALLOWED)).toBe(true);
    expect(isOriginAllowed("", ALLOWED)).toBe(true);
  });

  it("does not crash on malformed origins", () => {
    expect(isOriginAllowed("not a url", ALLOWED)).toBe(false);
    expect(isOriginAllowed("null", ALLOWED)).toBe(false); // sandboxed iframes send "null"
  });
});
