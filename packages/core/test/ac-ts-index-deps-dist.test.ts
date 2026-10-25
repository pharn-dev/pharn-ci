import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The CLI dist is gitignored and CI runs the tests before `pnpm build`, so the test bundles both entry points with
// scripts/bundle.mjs into a temp directory, checks those bundles and the committed action dist, and checks the CLI
// dist on disk when it exists.

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const PARSER_MARKERS = ["createSourceFile", "typescript5"];
const ACTION_LIMIT = 2_000_000;
const CLI_LIMIT = 1_000_000;

type Manifest = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

function manifest(path: string): Manifest {
  return JSON.parse(readFileSync(join(REPO, path), "utf8")) as Manifest;
}

function expectParserFree(label: string, bundle: Buffer, limit: number): void {
  const text = bundle.toString("utf8");
  for (const marker of PARSER_MARKERS) expect(text.includes(marker), `${label} contains ${marker}`).toBe(false);
  expect(bundle.length, `${label} size`).toBeLessThan(limit);
}

describe("the typescript5 dependency and the dists", () => {
  it("AC-14: core depends on typescript5 at npm:typescript@5.9.3 and both dists stay free of the parser", () => {
    expect(manifest("packages/core/package.json").dependencies?.typescript5).toBe("npm:typescript@5.9.3");
    expect(manifest("package.json").devDependencies?.typescript).toBe("~7.0.2");

    expectParserFree(
      "the committed packages/action/dist/index.js",
      readFileSync(join(REPO, "packages/action/dist/index.js")),
      ACTION_LIMIT,
    );
    const cliDist = join(REPO, "packages/cli/dist/index.js");
    if (existsSync(cliDist)) expectParserFree("packages/cli/dist/index.js", readFileSync(cliDist), CLI_LIMIT);

    const out = mkdtempSync(join(tmpdir(), "pharn-ci-ts-index-bundle-"));
    try {
      const bundles: [label: string, entry: string, limit: number][] = [
        ["a fresh action bundle", "packages/action/src/index.ts", ACTION_LIMIT],
        ["a fresh CLI bundle", "packages/cli/src/index.ts", CLI_LIMIT],
      ];
      for (const [label, entry, limit] of bundles) {
        const outfile = join(out, `${label.replace(/\W+/g, "-")}.js`);
        execFileSync(process.execPath, [join(REPO, "scripts/bundle.mjs"), join(REPO, entry), outfile], { cwd: REPO });
        expectParserFree(label, readFileSync(outfile), limit);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
