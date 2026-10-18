import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { purityViolations } from "./purity-check.js";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

describe("packages/core purity", () => {
  it.each(sourceFiles(SRC).map((f) => [f.slice(SRC.length), f]))("%s does no I/O", (name, file) => {
    const text = readFileSync(file, "utf8");
    expect(purityViolations(text), name).toEqual([]);
  });
});
