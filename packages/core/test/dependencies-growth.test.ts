import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { parseNpmLock } from "../src/dependencies/npmLock.js";
import { parseNpmManifest } from "../src/dependencies/npmManifest.js";
import { parsePnpmLock } from "../src/dependencies/pnpmLock.js";
import { parsePythonLock } from "../src/dependencies/pythonLock.js";
import { parseRequirements } from "../src/dependencies/pythonManifest.js";
import { parseIsoTime } from "../src/dependencies/registry.js";
import { parseYarnLock } from "../src/dependencies/yarnLock.js";
import { measureGrowth, threadCpuMs } from "./growth.js";

// A13 (dependency safety): the manifest and lockfile readers take time linear in their input, on realistic shapes and on
// shapes that would make a backtracking pattern or a nested loop quadratic. Growth is measured on this thread's CPU time
// with measureGrowth (growth.ts), after a warm-up call: 4 times the input must take under 8 times as long (near 4 is
// linear, near 16 quadratic), and the slowest call must finish within 15 s.

const SMALL = 50_000;
const LARGE = 200_000;

const sized = (unit: string, size: number) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
const entries = (size: number, entry: (i: number) => string) => {
  const parts: string[] = [];
  let length = 0;
  for (let i = 0; length < size; i++) {
    const part = entry(i);
    parts.push(part);
    length += part.length;
  }
  return parts;
};

async function linear(label: string, make: (size: number) => string, read: (text: string) => unknown) {
  const small = make(SMALL);
  const large = make(LARGE);
  read(small);
  read(large);
  let slowest = 0;
  const timed = (text: string) => () => {
    const start = threadCpuMs();
    read(text);
    slowest = Math.max(slowest, threadCpuMs() - start);
  };
  const growth = await measureGrowth(timed(small), timed(large));
  expect(slowest, `${label}: the slowest call finishes within 15 s of CPU time`).toBeLessThan(15_000);
  expect(growth.ratio, `${label}: ${growth.detail}`).toBeLessThan(8);
}

describe("dependency readers are linear", { timeout: 120_000 }, () => {
  it("package-lock.json", async () => {
    const make = (size: number) =>
      `{"lockfileVersion":3,"packages":{"":{"dependencies":{}},${entries(
        size,
        (i) =>
          `"node_modules/p${i}":{"version":"1.0.${i}","resolved":"https://registry.npmjs.org/p${i}/-/p${i}-1.0.${i}.tgz","integrity":"sha512-${"A".repeat(40)}"}`,
      ).join(",")}}}`;
    await linear("package-lock.json", make, parseNpmLock);
  });

  it("pnpm-lock.yaml, and a line of colons and quotes", async () => {
    const make = (size: number) =>
      `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies: {}\n\npackages:\n\n${entries(
        size,
        (i) =>
          `  p${i}@1.0.${i}:\n    resolution: {integrity: sha512-${"B".repeat(40)}, tarball: https://x/p${i}.tgz}\n\n`,
      ).join("")}`;
    await linear("pnpm-lock.yaml", make, parsePnpmLock);
    await linear("pnpm hostile", (size) => `lockfileVersion: 9\n'${sized("':", size)}`, parsePnpmLock);
    await linear("pnpm flow", (size) => `lockfileVersion: 9\na: {${sized("k: 'v,', ", size)}}`, parsePnpmLock);
  });

  // CORE-110: the YAML subset pnpm writes is read in one pass per line, on long hostile lines that are read to the end.
  it("pnpm-lock.yaml: long lines of blanks, list items, flow parts, nesting and plain text", async () => {
    const read = (text: string) => expect(parsePnpmLock(text)).not.toBeNull();
    const pnpm = (body: string) => `lockfileVersion: '9.0'\n${body}\n`;
    await linear("blanks before a colon", (size) => pnpm(`k${sized(" \t", size)}:\t\tv`), read);
    await linear("blanks after a colon", (size) => pnpm(`k:${sized("\t ", size)}v`), read);
    await linear("list items on one line", (size) => pnpm(`a:\n  ${sized("- ", size)}x`), read);
    await linear(
      "distinct flow keys",
      (size) => pnpm(`a: {${entries(size, (i) => `k${i} : 'v,#', `).join("")}z: 1}`),
      read,
    );
    await linear("nested flow", (size) => pnpm(`a: ${"[".repeat(size / 2)}${"]".repeat(size / 2)}`), read);
    await linear("plain text and a comment", (size) => pnpm(`a: ${sized("x:x ", size)}# c: d`), read);
    await linear("quoted key and blanks", (size) => pnpm(`'${sized("''", size)}' ${sized(" ", size)}: v`), read);
  });

  it("yarn.lock and a header of commas", async () => {
    const make = (size: number) =>
      entries(
        size,
        (i) => `"p${i}@^1.0.0", p${i}@^1.0.1:\n  version "1.0.${i}"\n  resolved "https://x/p${i}"\n\n`,
      ).join("");
    await linear("yarn.lock", make, parseYarnLock);
    await linear("yarn hostile", (size) => `${sized('"a@1",', size)}:\n`, parseYarnLock);
  });

  it("uv.lock, and TOML strings and arrays", async () => {
    const make = (size: number) =>
      `version = 1\n${entries(
        size,
        (i) =>
          `[[package]]\nname = "p${i}"\nversion = "1.0.${i}"\nsource = { registry = "https://pypi.org/simple" }\n\n`,
      ).join("")}`;
    await linear("uv.lock", make, (text) => parsePythonLock(text, "uv"));
    await linear(
      "toml array",
      (size) => `a = [${sized('"x\\"y", ', size)}]`,
      (text) => parsePythonLock(text, "uv"),
    );
    await linear(
      "toml unclosed",
      (size) => `a = "${sized("\\\\", size)}`,
      (text) => parsePythonLock(text, "poetry"),
    );
  });

  it("requirements files with continuations, comments and options", async () => {
    await linear(
      "requirements",
      (size) => sized("pkg-a[x]>=1.0 ; python_version > '3' # c\n", size),
      parseRequirements,
    );
    await linear("continuations", (size) => `a==1 ${sized("\\\n ", size)}`, parseRequirements);
    await linear("spaces", (size) => `a${sized(" \t", size)}--x`, parseRequirements);
    // CORE-108: option lines are split like shlex and every option resolved like optparse.
    await linear(
      "options on one line",
      (size) => sized("--pre --ex 'https://x/' -ihttps://y/ ", size),
      parseRequirements,
    );
    await linear("one long option", (size) => `--${sized("x", size)}`, parseRequirements);
    await linear("unclosed quote", (size) => `--index-url "${sized('\\"x', size)}`, parseRequirements);
    await linear("backslashes", (size) => `${sized("\\", size)}x\\`, parseRequirements);
  });

  // CORE-115: package.json override fields; a long parent key over many nested leaves must not be copied into each leaf.
  it("package.json overrides, resolutions and pnpm.overrides", async () => {
    const leaves = (size: number) =>
      entries(size, (i) => `"p${i}":"github:a/b",`)
        .join("")
        .slice(0, -1);
    await linear(
      "long parent key",
      (size) => `{"overrides":{"${"k".repeat(size / 2)}":{${leaves(size / 2)}}}}`,
      parseNpmManifest,
    );
    await linear(
      "flat fields",
      (size) =>
        `{"overrides":{${leaves(size / 3)}},"resolutions":{${leaves(size / 3)}},"pnpm":{"overrides":{${leaves(size / 3)}}}}`,
      parseNpmManifest,
    );
    await linear(
      "selectors",
      (size) => `{"pnpm":{"overrides":{"${sized("a@>", size)}":"1"}},"resolutions":{"${sized("@a/", size)}":"1"}}`,
      parseNpmManifest,
    );
  });

  // CORE-100: a lockfile may now be 32 MiB, so the whole path a large pnpm-lock.yaml takes through check() (both sides
  // read, the entries compared, the report built) must stay linear too, at megabyte sizes, not only the parser.
  it("a pnpm-lock.yaml judged end to end through check(), at 1 MiB and 4 MiB a side", async () => {
    const lock = (size: number) =>
      `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies: {}\n\npackages:\n\n${entries(
        size,
        (i) => `  p${i}@1.0.${i}:\n    resolution: {integrity: sha512-${"B".repeat(86)}==}\n\n`,
      ).join("")}`;
    const judged = (size: number) => {
      const base = lock(size);
      const head = `${base}  from-git@https://codeload.github.com/o/r/tar.gz/0123456789abcdef0123456789abcdef01234567:\n    resolution: {tarball: https://codeload.github.com/o/r/tar.gz/0123456789abcdef0123456789abcdef01234567}\n`;
      return () =>
        check({
          version: "0.1.0",
          coverage: { missingFile: "coverage/lcov.info" },
          diff: {
            text: "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\n--- a/pnpm-lock.yaml\n+++ b/pnpm-lock.yaml\n@@ -1,0 +2 @@\n+x\n",
          },
          repoRoot: "/r",
          threshold: null,
          repoFiles: ["pnpm-lock.yaml"],
          dependencySources: {
            base: { files: [{ path: "pnpm-lock.yaml", text: base }], dropped: [] },
            head: { files: [{ path: "pnpm-lock.yaml", text: head }], dropped: [] },
          },
        });
    };
    const small = judged(1_048_576);
    const large = judged(4_194_304);
    const warm = large();
    expect(warm.dependencies?.unread, "control: the lockfile is read").toBeUndefined();
    expect(warm.dependencies?.signals.map((s) => s.id)).toEqual(["D05"]);
    small();
    let slowest = 0;
    const timed = (run: () => unknown) => () => {
      const start = threadCpuMs();
      run();
      slowest = Math.max(slowest, threadCpuMs() - start);
    };
    const growth = await measureGrowth(timed(small), timed(large));
    expect(slowest, "check(): the slowest call finishes within 15 s of CPU time").toBeLessThan(15_000);
    expect(growth.ratio, `check() on a pnpm-lock.yaml: ${growth.detail}`).toBeLessThan(8);
  });

  it("refuses a long time string before matching it", () => {
    expect(parseIsoTime(`2024-01-01T00:00:00.${"1".repeat(100_000)}Z`)).toBeNull();
  });
});
