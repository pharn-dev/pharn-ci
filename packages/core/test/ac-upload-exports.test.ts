import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { purityViolations } from "./purity-check.js";

// The package entry is loaded, and packages/core/src/upload/ is listed, inside the test body: the AC test is written
// before the upload module exists, so nothing the build adds may run while this file loads.

const UPLOAD_DIR = fileURLToPath(new URL("../src/upload/", import.meta.url));

// Core's index loads cold, which can take seconds on a loaded host.
describe("the upload module's exports and purity", { timeout: 60_000 }, () => {
  it("AC-9: @pharn-ci/core exports the upload names, and every file in packages/core/src/upload/ is pure", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Record<string, unknown>;
    for (const name of ["buildUploadMeta", "buildUploadBundle", "buildUploadTar", "withUploadOutcome"]) {
      expect(typeof core[name], name).toBe("function");
    }
    expect(core.UPLOAD_REPORT_MAX_BYTES).toBe(5242880);

    const sources = readdirSync(UPLOAD_DIR, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => join(entry.parentPath, entry.name));
    const names = sources.map((path) => path.slice(UPLOAD_DIR.length)).sort();
    for (const file of ["bundle.ts", "meta.ts", "outcome.ts", "tar.ts"]) expect(names, file).toContain(file);
    for (const path of sources) {
      const text = readFileSync(path, "utf8");
      expect(purityViolations(text), path).toEqual([]);
      expect(text, `${path}: no TextEncoder`).not.toMatch(/\bTextEncoder\b/);
      expect(text, `${path}: no globalThis`).not.toMatch(/\bglobalThis\b/);
    }
  });
});
