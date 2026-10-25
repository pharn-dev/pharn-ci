import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The documents are read inside the test body, so the file loads whatever they say.

const ROOT = new URL("../../../", import.meta.url);
const REPO_ROOT = fileURLToPath(ROOT);
/** The commit this increment starts from. */
const BASE_COMMIT = "0873ce23f3595a3497325635b7bf3ee93ea77687";

/** The text from the heading that starts with `start` up to the next `## ` heading, or to the end. */
function section(text: string, start: string): string {
  const at = text.split("\n").findIndex((line) => line.startsWith(start));
  if (at === -1) throw new Error(`no heading starting "${start}"`);
  const rest = text.split("\n").slice(at);
  const next = rest.findIndex((line, i) => i > 0 && line.startsWith("## "));
  return (next === -1 ? rest : rest.slice(0, next)).join("\n");
}

describe("test sources: documentation and schema", () => {
  it("AC-16: the threat model and LIMITS §8 describe the new read, and the schemas are byte-identical to the base", () => {
    const threatModel = readFileSync(new URL("docs/THREAT-MODEL.md", ROOT), "utf8");
    const surfaces = section(threatModel, "## 2.");
    for (const phrase of ["cat-file", "untrusted", "in memory", "test-config"]) {
      expect(surfaces, `THREAT-MODEL §2 names "${phrase}"`).toContain(phrase);
    }
    expect(surfaces, "THREAT-MODEL §2 says the text is never written").toMatch(/never written/i);
    expect(surfaces, "THREAT-MODEL §2 says the text never leaves the job").toMatch(/never sent out of the job/i);

    const limits = readFileSync(new URL("docs/LIMITS.md", ROOT), "utf8");
    const at = limits.split("\n").findIndex((line) => line.startsWith("## 8."));
    expect(at, "docs/LIMITS.md has a ## 8. heading").toBeGreaterThan(-1);
    const sizeLimits = limits.split("\n").slice(at).join("\n");
    expect(sizeLimits).toContain("200");
    expect(sizeLimits).toMatch(/524288|512 KiB/);
    expect(sizeLimits).toMatch(/16777216|16 MiB/);
    for (const reason of ["too-large", "over-file-cap", "over-total-cap", "binary", "missing", "unsafe-path"]) {
      expect(sizeLimits, `LIMITS §8 names the drop reason ${reason}`).toContain(reason);
    }

    for (const path of ["schema/report.v1.json", "schema/report.v2.json"]) {
      const atBase = execFileSync("git", ["show", `${BASE_COMMIT}:${path}`], { cwd: REPO_ROOT });
      const now = readFileSync(new URL(path, ROOT));
      expect(now.equals(atBase), `${path} is byte-identical to ${BASE_COMMIT}`).toBe(true);
    }
  });
});
