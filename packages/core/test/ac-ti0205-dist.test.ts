import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The committed action dist must now carry the TypeScript parser that check() uses, within a new size bound. Fresh
// bundles of both entry points are made with scripts/bundle.mjs into a temp directory, as the #87 dist test makes them.
// (CORE-132: the comparison of every package.json with an old commit was a history pin and is removed.)

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const LIMIT = 12_000_000;
const MARKER = "createSourceFile";

type Manifest = { dependencies?: Record<string, string> };

function expectParser(label: string, bundle: Buffer): void {
  expect(bundle.toString("utf8").includes(MARKER), `${label} contains ${MARKER}`).toBe(true);
  expect(bundle.length, `${label} is smaller than ${LIMIT} bytes`).toBeLessThan(LIMIT);
}

describe("the dists carry the TypeScript parser", () => {
  it("AC-19: the committed action dist and fresh action and CLI bundles contain createSourceFile under 12,000,000 bytes, and core still depends on typescript5 at npm:typescript@5.9.3", () => {
    expectParser(
      "the committed packages/action/dist/index.js",
      readFileSync(join(REPO, "packages/action/dist/index.js")),
    );

    const out = mkdtempSync(join(tmpdir(), "pharn-ci-ti0205-bundle-"));
    try {
      for (const [label, entry] of [
        ["a fresh action bundle", "packages/action/src/index.ts"],
        ["a fresh CLI bundle", "packages/cli/src/index.ts"],
      ] as const) {
        const outfile = join(out, `${label.replace(/\W+/g, "-")}.js`);
        execFileSync(process.execPath, [join(REPO, "scripts/bundle.mjs"), join(REPO, entry), outfile], { cwd: REPO });
        expectParser(label, readFileSync(outfile));
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }

    const core = JSON.parse(readFileSync(join(REPO, "packages/core/package.json"), "utf8")) as Manifest;
    expect(core.dependencies?.typescript5).toBe("npm:typescript@5.9.3");
  }, 180_000);
});
