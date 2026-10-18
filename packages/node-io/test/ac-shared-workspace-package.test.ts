import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every file is read inside the test body: these tests are written before `packages/node-io/package.json` and the
// workspace wiring exist, so a missing file must fail its test, not the loading of this file.

const REPO = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, REPO), "utf8");
const readJson = (path: string) => JSON.parse(read(path));

describe("the @pharn-ci/node-io workspace package", () => {
  it("AC-3: packages/node-io/package.json is private, named @pharn-ci/node-io, at VERSION, and exports . with a source condition", async () => {
    const { VERSION } = await import("../../core/src/version.js");
    const pkg = readJson("packages/node-io/package.json");
    expect(pkg.private).toBe(true);
    expect(pkg.name).toBe("@pharn-ci/node-io");
    expect(pkg.version).toBe(VERSION);
    expect(pkg.exports?.["."]?.source).toBe("./src/index.ts");
  });

  it("AC-3: the CLI and the Action list @pharn-ci/node-io as workspace:*", () => {
    for (const manifest of ["packages/cli/package.json", "packages/action/package.json"]) {
      const pkg = readJson(manifest);
      expect(pkg.devDependencies?.["@pharn-ci/node-io"], manifest).toBe("workspace:*");
    }
  });

  it("AC-3: no file under packages/core/src imports @pharn-ci/node-io", () => {
    const root = new URL("packages/core/src/", REPO);
    const files = (readdirSync(root, { recursive: true }) as string[]).filter((file) => /\.[cm]?[jt]s$/.test(file));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(new URL(file, root), "utf8");
      expect(text.includes("@pharn-ci/node-io"), `packages/core/src/${file}`).toBe(false);
    }
    // The package exists, so the absence above is about core, not about a package that is not there yet.
    expect(readJson("packages/node-io/package.json").name).toBe("@pharn-ci/node-io");
  });

  it("AC-3: AGENTS.md's Layout section names packages/node-io", () => {
    const agents = read("AGENTS.md");
    const start = agents.indexOf("\n## Layout\n");
    expect(start).toBeGreaterThanOrEqual(0);
    const next = agents.indexOf("\n## ", start + 1);
    const layout = agents.slice(start, next === -1 ? undefined : next);
    expect(layout).toContain("packages/node-io");
  });
});
