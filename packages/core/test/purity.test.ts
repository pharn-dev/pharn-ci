import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

describe("packages/core purity", () => {
  it.each(sourceFiles(SRC).map((f) => [f.slice(SRC.length), f]))("%s does no I/O", (_name, file) => {
    const text = readFileSync(file, "utf8");
    const imports = [
      ...text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm),
      ...text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g),
    ].map((m) => m[1]);
    for (const spec of imports) expect(spec, `import of "${spec}"`).toMatch(/^\.\.?\//);
    expect(text).not.toMatch(/\b(process|require|fetch|globalThis)\s*[.(]/);
  });
});
