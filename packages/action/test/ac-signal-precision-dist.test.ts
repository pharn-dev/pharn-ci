import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The committed action dist must carry this change's code (the TI09 project matcher, the TI06 expect-subject reader
// and the TI11 `run-script` key), and so must a fresh bundle of the action entry point made with scripts/bundle.mjs
// into a temp directory (as the earlier dist tests make it). No package.json may gain a dependency compared with the
// base commit this increment starts from. The files are read inside the test body.

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "5860ba4d26636ff484d2228312ae10e1ae439658";
const MARKERS = ["compareProjects", "readEqualityCalls", '"run-script"'];
const DEPENDENCY_KEYS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

type Manifest = Partial<Record<(typeof DEPENDENCY_KEYS)[number], Record<string, string>>>;

const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" });

describe("the action dist carries this change's code; no dependency is added", () => {
  it("AC-14: the committed packages/action/dist/index.js and a fresh bundle of packages/action/src/index.ts contain this change's code, and no package.json gains a dependency compared with the base commit", () => {
    const committed = readFileSync(join(REPO, "packages/action/dist/index.js"), "utf8");
    for (const marker of MARKERS)
      expect(committed.includes(marker), `the committed dist contains ${marker}`).toBe(true);

    const out = mkdtempSync(join(tmpdir(), "pharn-ci-signal-precision-bundle-"));
    try {
      const outfile = join(out, "action.js");
      execFileSync(
        process.execPath,
        [join(REPO, "scripts/bundle.mjs"), join(REPO, "packages/action/src/index.ts"), outfile],
        { cwd: REPO },
      );
      const fresh = readFileSync(outfile, "utf8");
      for (const marker of MARKERS)
        expect(fresh.includes(marker), `a fresh action bundle contains ${marker}`).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }

    // Tracked and untracked (not ignored) manifests, so a package.json the build adds is compared too; fixture
    // manifests are test data, as in the earlier dist tests.
    const manifests = [
      ...new Set(
        git("ls-files", "--cached", "--others", "--exclude-standard", "package.json", "**/package.json").split("\n"),
      ),
    ].filter((path) => path !== "" && !path.startsWith("fixtures/"));
    expect(manifests).toContain("package.json");
    expect(manifests).toContain("packages/core/package.json");
    expect(manifests).toContain("packages/action/package.json");
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
