import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// CORE-356 (AC-10). The hand-written Python import reader is gone: no file under packages/core/src is
// signals/pythonAliases.ts, and no file there imports or re-exports a module named pythonAliases.

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/** Every file under packages/core/src, as a repo-relative-to-src path with forward slashes. */
function listFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = join(dir, name);
      const rel = `${prefix}${name}`;
      return statSync(full).isDirectory() ? listFiles(full, `${rel}/`) : [rel];
    });
}

/** The module specifiers a file names in `from "…"`, `import "…"`, `import("…")` and `require("…")`. */
function specifiers(text: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) out.push(m[1] as string);
  }
  return out;
}

const namesPythonAliases = (spec: string) => /(?:^|\/)pythonAliases(?:\.[cm]?[jt]s)?$/.test(spec);

describe("CORE-356: core has no Python import reader of its own", () => {
  it("AC-10: no file under packages/core/src is signals/pythonAliases.ts, and none imports a module named pythonAliases", () => {
    const files = listFiles(SRC);
    expect(files.length, "packages/core/src is listed").toBeGreaterThan(10);
    expect(files, "signals/ti03.ts is listed (the walk reaches subdirectories)").toContain("signals/ti03.ts");
    expect(files, "no signals/pythonAliases.ts").not.toContain("signals/pythonAliases.ts");
    expect(
      files.filter((f) => /(?:^|\/)pythonAliases\.[cm]?[jt]s$/.test(f)),
      "no pythonAliases module anywhere",
    ).toEqual([]);

    const importers = files
      .filter((f) => /\.[cm]?[jt]s$/.test(f))
      .flatMap((f) =>
        specifiers(readFileSync(join(SRC, f), "utf8"))
          .filter(namesPythonAliases)
          .map((spec) => `${f} -> ${spec}`),
      );
    expect(importers, "no file imports a module named pythonAliases").toEqual([]);
  });
});
