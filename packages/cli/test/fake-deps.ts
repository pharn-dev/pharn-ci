import { readFileSync } from "node:fs";
import type { CliDeps } from "../src/main.js";

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
export const fixture = (p: string) => readFileSync(new URL(p, FIXTURES), "utf8");

export interface Fake extends CliDeps {
  out: string;
  err: string;
  gitCalls: string[][];
}

export function fakeDeps(files: Record<string, string>, gitOverrides: Record<string, string | Error> = {}): Fake {
  const fake: Fake = {
    cwd: "/repo/sub",
    out: "",
    err: "",
    gitCalls: [],
    async git(args) {
      fake.gitCalls.push(args);
      const override = gitOverrides[args[0] as string];
      if (override instanceof Error) throw override;
      if (override !== undefined) return override;
      if (args[0] === "rev-parse") return "/repo\n";
      if (args[0] === "diff") return fixture("golden/pr.diff");
      if (args[0] === "ls-files") return `${fixture("golden/files.txt").trim().split("\n").join("\0")}\0`;
      if (args[0] === "ls-tree") return "";
      throw new Error(`unexpected git ${args.join(" ")}`);
    },
    async readFile(path) {
      return files[path] ?? null;
    },
    resolvePath: (...segments) =>
      segments.reduce((acc, s) => (s.startsWith("/") ? s : `${acc.replace(/\/$/, "")}/${s.replace(/^\.\//, "")}`), ""),
    stdout: (t) => {
      fake.out += t;
    },
    stderr: (t) => {
      fake.err += t;
    },
  };
  return fake;
}

export const coverage = {
  "/repo/sub/lcov.info": fixture("golden/coverage.info").replaceAll("/home/runner/work/demo/demo", "/repo"),
};
