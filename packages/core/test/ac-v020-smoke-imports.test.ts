import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// release-readiness-v020: scripts/smoke-release.mjs uses Node built-ins only and nothing that reaches the network.
// The script is read inside the test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const NETWORK = ["node:http", "node:https", "node:http2", "node:net", "node:tls", "node:dns", "node:dgram"];

const SPECIFIERS = [
  /\bimport\s+[^"';]*?\bfrom\s*["']([^"']+)["']/g,
  /\bexport\s+[^"';]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
];

describe("release-readiness-v020: the release smoke script's imports", () => {
  it("AC-14: every import and require specifier starts node:, none is a network module, and the text has no fetch(", () => {
    const text = readFileSync(`${ROOT}scripts/smoke-release.mjs`, "utf8");
    const specifiers = SPECIFIERS.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[1] as string));
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier.startsWith("node:"), specifier).toBe(true);
      expect(NETWORK, specifier).not.toContain(specifier);
    }
    expect(text).not.toContain("fetch(");
  });
});
