import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// AC-1 of undici-audit-clean-2: the committed pnpm-lock.yaml resolves every undici 6.x entry to 6.29.1 or later, the
// release that clears GHSA-xjj6-f33q-929c, GHSA-2m5v-pch6-74hx, GHSA-qrxm-fqhp-jwvm, GHSA-4qv8-2p9j-2685 and
// GHSA-9fm3-97px-rjf6. undici is transitive (through @actions/http-client), so the lockfile is where the version lives.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXED = [6, 29, 1] as const;

// Every `undici@<version>` package key (quoted or not, with or without a peer suffix) and every `undici: <version>`
// dependency entry. Exact `undici` only: `undici-types@` and `undici-types:` never match.
function undiciVersions(lockText: string): string[] {
  const versions: string[] = [];
  const keyPattern = /(?<![\w./-])undici@(\d+\.\d+\.\d+)/g;
  const depPattern = /^\s+['"]?undici['"]?:\s*['"]?(\d+\.\d+\.\d+)/gm;
  for (const match of lockText.matchAll(keyPattern)) versions.push(match[1] as string);
  for (const match of lockText.matchAll(depPattern)) versions.push(match[1] as string);
  return versions;
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

describe("the committed lockfile resolves undici to a fixed release", () => {
  it("AC-1: every undici@<version> key and undici: <version> entry in pnpm-lock.yaml is at least 6.29.1, and a 6.x resolution exists", () => {
    const lockText = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");
    const versions = undiciVersions(lockText);

    expect(versions.length, "pnpm-lock.yaml holds at least one undici resolution").toBeGreaterThan(0);
    expect(
      versions.some((v) => v.startsWith("6.")),
      "pnpm-lock.yaml holds at least one undici 6.x resolution",
    ).toBe(true);
    expect(versions.filter(isBelowFixed)).toEqual([]);
  });
});
