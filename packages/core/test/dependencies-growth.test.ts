import { describe, expect, it } from "vitest";
import { parseNpmLock } from "../src/dependencies/npmLock.js";
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
  });

  it("refuses a long time string before matching it", () => {
    expect(parseIsoTime(`2024-01-01T00:00:00.${"1".repeat(100_000)}Z`)).toBeNull();
  });
});
