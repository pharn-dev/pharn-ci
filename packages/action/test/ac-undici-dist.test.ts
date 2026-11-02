import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// AC-2 of undici-audit-clean-2: the committed action bundle carries undici 6.29.1 or later. Users of the Action run
// packages/action/dist, so the bundled copy is what matters; esbuild leaves a `node_modules/.pnpm/undici@<version>/`
// path comment above each bundled module, which is how the bundled version is read here.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DIST = join(ROOT, "packages/action/dist");
const FIXED = [6, 29, 1] as const;
const MAX_DIST_BYTES = 12_000_000;

// Each `node_modules/.pnpm/undici@<version>/` path comment. Exact `undici@` only: `undici-types@` never matches.
function bundledUndiciVersions(text: string): string[] {
  const pattern = /node_modules\/\.pnpm\/undici@(\d+\.\d+\.\d+)[^/\s]*\//g;
  return [...text.matchAll(pattern)].map((match) => match[1] as string);
}

function isBelowFixed(version: string): boolean {
  const parts = version.split(".").map(Number);
  for (let i = 0; i < FIXED.length; i++) {
    const have = parts[i] ?? 0;
    const want = FIXED[i] as number;
    if (have !== want) return have < want;
  }
  return false;
}

describe("the committed action dist bundles a fixed undici", () => {
  it("AC-2: every node_modules/.pnpm/undici@<version>/ comment in packages/action/dist is at least 6.29.1, one exists, and the dist is below 12,000,000 bytes", () => {
    const files = readdirSync(DIST, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));

    // Read each file once and take its size from the bytes read, so the size and the scan see the same content.
    const versions: string[] = [];
    let totalBytes = 0;
    for (const path of files) {
      const bytes = readFileSync(path);
      totalBytes += bytes.length;
      versions.push(...bundledUndiciVersions(bytes.toString("utf8")));
    }

    expect(versions.length, "packages/action/dist holds at least one undici path comment").toBeGreaterThan(0);
    expect(versions.filter(isBelowFixed)).toEqual([]);
    expect(totalBytes).toBeLessThan(MAX_DIST_BYTES);
  });
});
