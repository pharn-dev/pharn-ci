import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// release-readiness-v020: the release smoke runs the bundle with a fresh environment. A CI runner's event and token
// must not reach it: the bundle gets only the six INPUT_* values and the four runner paths, all inside the TMPDIR the
// script was given. The fake bundle records its own environment to a file outside that TMPDIR.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts/smoke-release.mjs");
const TIMEOUT = 110_000;

const INPUTS = [
  "INPUT_BASE-REF",
  "INPUT_COMMENT",
  "INPUT_COVERAGE-FILE",
  "INPUT_GITHUB-TOKEN",
  "INPUT_TEST-INTEGRITY",
  "INPUT_THRESHOLD",
];

describe("release-readiness-v020: the release smoke's bundle environment", () => {
  it(
    "AC-13: the bundle sees none of the parent's GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_TOKEN or INPUT_PR-NUMBER, exactly the six INPUT_ values, and runner paths inside TMPDIR",
    () => {
      expect(existsSync(SCRIPT), SCRIPT).toBe(true);
      const setup = mkdtempSync(join(tmpdir(), "ac-v020-smoke-env-setup-"));
      const tmp = mkdtempSync(join(tmpdir(), "ac-v020-smoke-env-tmp-"));
      try {
        const record = join(setup, "recorded-env.json");
        const eventPath = join(setup, "event.json");
        writeFileSync(eventPath, `${JSON.stringify({ pull_request: { number: 1 } })}\n`);
        mkdirSync(join(setup, "action/packages/action/dist"), { recursive: true });
        writeFileSync(
          join(setup, "action/packages/action/package.json"),
          `${JSON.stringify({ name: "fake-action", version: "0.1.0", type: "module" })}\n`,
        );
        writeFileSync(
          join(setup, "action/packages/action/dist/index.js"),
          `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(record)}, JSON.stringify(process.env));\n`,
        );

        const run = spawnSync(process.execPath, [SCRIPT, join(setup, "action")], {
          cwd: ROOT,
          env: {
            ...process.env,
            GITHUB_EVENT_NAME: "pull_request",
            GITHUB_EVENT_PATH: eventPath,
            GITHUB_TOKEN: "ac-v020-not-a-real-token",
            "INPUT_PR-NUMBER": "1",
            TMPDIR: tmp,
          },
          encoding: "utf8",
          timeout: TIMEOUT,
        });
        const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
        expect(existsSync(record), `the fake bundle never ran\n${output}`).toBe(true);
        const env = JSON.parse(readFileSync(record, "utf8")) as Record<string, string>;

        for (const name of ["GITHUB_EVENT_NAME", "GITHUB_EVENT_PATH", "GITHUB_TOKEN", "INPUT_PR-NUMBER"]) {
          expect(Object.keys(env), name).not.toContain(name);
        }
        expect(
          Object.keys(env)
            .filter((key) => key.startsWith("INPUT_"))
            .sort(),
        ).toEqual(INPUTS);
        expect(env["INPUT_COVERAGE-FILE"]).not.toBe("");
        expect(env["INPUT_BASE-REF"]).toBe("HEAD~1");
        expect(env["INPUT_TEST-INTEGRITY"]).toBe("block");
        expect(env.INPUT_COMMENT).toBe("false");
        expect(env["INPUT_GITHUB-TOKEN"]).toBe("");

        const bases = [resolve(tmp), realpathSync(tmp)];
        const inside = (path: string) => {
          const candidates = [resolve(path)];
          if (existsSync(path)) candidates.push(realpathSync(path));
          return candidates.some((p) => bases.some((base) => p.startsWith(base + sep)));
        };
        for (const name of ["GITHUB_WORKSPACE", "GITHUB_STEP_SUMMARY", "GITHUB_OUTPUT", "RUNNER_TEMP"]) {
          const value = env[name];
          expect(value, name).toBeTypeOf("string");
          expect(inside(value as string), `${name}=${value} is not inside ${bases.join(" or ")}`).toBe(true);
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true });
        rmSync(setup, { recursive: true, force: true });
      }
    },
    TIMEOUT + 10_000,
  );
});
