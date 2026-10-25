import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// indexPythonTests is loaded inside the test body: this test is written before it exists, so nothing the build adds
// may run while the file loads. The real interpreter runs; a missing python3 fails the test. The planted modules are
// written to a fresh temporary directory at run time; the parent's cwd and PYTHONPATH are restored afterwards.

const SLOW = 60_000;
const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/py-index/${name}`, import.meta.url), "utf8");

type Run = { available: true; files: { path: string; result: unknown }[] } | { available: false; reason: string };

const PLANTED = ["ast.py", "json.py", "sitecustomize.py"];

describe("indexPythonTests: modules planted on the parent's path", () => {
  it(
    "AC-16: ignores ast.py, json.py and sitecustomize.py in the parent's cwd and PYTHONPATH and still matches the AC-1 golden",
    async () => {
      const io = (await import("../src/index.js")) as unknown as {
        indexPythonTests: (files: { path: string; text: string }[]) => Promise<Run>;
      };
      const text = fixture("test_functions.py.txt");
      const golden = JSON.parse(fixture("test_functions.index.json")) as unknown;

      const dir = mkdtempSync(join(tmpdir(), "pharn-ci-planted-"));
      const cwd = process.cwd();
      const pythonPath = process.env.PYTHONPATH;
      try {
        for (const name of PLANTED) {
          writeFileSync(join(dir, name), `raise RuntimeError("planted ${name} was imported")\n`);
        }
        // The plant is live: a plain python3 run from there imports the planted json.py and fails.
        expect(() =>
          execFileSync("python3", ["-c", "import json"], {
            cwd: dir,
            env: { ...process.env, PYTHONPATH: dir },
            stdio: "pipe",
          }),
        ).toThrow();

        process.chdir(dir);
        process.env.PYTHONPATH = dir;
        const run = await io.indexPythonTests([{ path: "tests/test_functions.py", text }]);

        if (!run.available) throw new Error(`the run is unavailable: ${JSON.stringify(run)}`);
        expect(run.files.map((f) => f.path)).toEqual(["tests/test_functions.py"]);
        expect(run.files[0]?.result).toStrictEqual(golden);
      } finally {
        process.chdir(cwd);
        if (pythonPath === undefined) delete process.env.PYTHONPATH;
        else process.env.PYTHONPATH = pythonPath;
        rmSync(dir, { recursive: true, force: true });
      }
    },
    SLOW,
  );
});
