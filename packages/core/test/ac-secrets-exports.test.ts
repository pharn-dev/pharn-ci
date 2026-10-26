import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { purityViolations } from "./purity-check.js";

// The package entry is loaded inside the test body, and packages/core/src/secrets/ is listed there: the AC test is
// written before the redaction module and the A7 scanner exist, so nothing the build adds may run while the file loads.

const SECRETS_DIR = fileURLToPath(new URL("../src/secrets/", import.meta.url));

const EXPORTS = [
  "findSecretSpans",
  "redactSecrets",
  "truncateUtf8",
  "redactMessage",
  "MESSAGE_MAX_BYTES",
  "SECRET_SCAN_KINDS",
  "agentConfigSecretPaths",
  "scanAgentConfigSecrets",
] as const;
const FUNCTIONS = new Set([
  "findSecretSpans",
  "redactSecrets",
  "truncateUtf8",
  "redactMessage",
  "agentConfigSecretPaths",
  "scanAgentConfigSecrets",
]);

describe("the redaction module and the A7 scanner are pure and exported", () => {
  it("AC-21: every file under packages/core/src/secrets/ passes the purity check, and @pharn-ci/core exports the eight names", async () => {
    const sources = readdirSync(SECRETS_DIR, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => join(entry.parentPath, entry.name));
    expect(sources.length, "packages/core/src/secrets/ holds the new sources").toBeGreaterThan(0);
    for (const path of sources) {
      expect(purityViolations(readFileSync(path, "utf8")), path).toEqual([]);
    }

    const core = (await import("@pharn-ci/core")) as unknown as Record<string, unknown>;
    for (const name of EXPORTS) {
      expect(Object.hasOwn(core, name), `@pharn-ci/core exports ${name}`).toBe(true);
      if (FUNCTIONS.has(name)) expect(typeof core[name], name).toBe("function");
    }
    expect(typeof core.MESSAGE_MAX_BYTES).toBe("number");
    expect(Array.isArray(core.SECRET_SCAN_KINDS), "SECRET_SCAN_KINDS is a list").toBe(true);
  });
});
