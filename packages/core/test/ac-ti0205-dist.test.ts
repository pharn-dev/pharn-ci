import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The committed action dist must now carry the TypeScript parser that check() uses, within a new size bound, and no
// package.json may gain a dependency. Fresh bundles of both entry points are made with scripts/bundle.mjs into a temp
// directory, as the #87 dist test makes them. The base commit is the main commit this increment starts from.

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "ad8277c42ca0123fb129d8f9a079ee2b25950025";
const LIMIT = 12_000_000;
const MARKER = "createSourceFile";
const DEPENDENCY_KEYS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

type Manifest = Partial<Record<(typeof DEPENDENCY_KEYS)[number], Record<string, string>>>;

const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" });

function expectParser(label: string, bundle: Buffer): void {
  expect(bundle.toString("utf8").includes(MARKER), `${label} contains ${MARKER}`).toBe(true);
  expect(bundle.length, `${label} is smaller than ${LIMIT} bytes`).toBeLessThan(LIMIT);
}

describe("the dists carry the TypeScript parser; no dependency is added", () => {
  it("AC-19: the committed action dist and fresh action and CLI bundles contain createSourceFile under 12,000,000 bytes, core still depends on typescript5 at npm:typescript@5.9.3, and no package.json gains a dependency", () => {
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

    const manifests = git("ls-files", "package.json", "**/package.json")
      .split("\n")
      .filter((path) => path !== "" && !path.startsWith("fixtures/"));
    expect(manifests).toContain("package.json");
    expect(manifests).toContain("packages/core/package.json");
    for (const path of manifests) {
      const now = JSON.parse(readFileSync(join(REPO, path), "utf8")) as Manifest;
      let before: Manifest = {};
      try {
        before = JSON.parse(git("show", `${BASE}:${path}`)) as Manifest;
      } catch {
        before = {};
      }
      for (const key of DEPENDENCY_KEYS) {
        const added = Object.keys(now[key] ?? {}).filter((name) => !Object.hasOwn(before[key] ?? {}, name));
        expect(added, `${path} ${key} gains no dependency`).toEqual([]);
      }
    }
  }, 180_000);
});
