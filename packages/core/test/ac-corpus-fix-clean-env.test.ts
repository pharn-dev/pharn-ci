import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// corpus-run-errors-3: scripts/corpus-run.mjs exports `cleanEnv(base)`, the environment the CLI runs with. Besides
// dropping the git location variables, it appends `core.hooksPath=/dev/null`, `gc.auto=0` and
// `maintenance.auto=false` after any existing GIT_CONFIG_KEY_<n> / GIT_CONFIG_VALUE_<n> pairs, so the CLI's git calls
// never run automatic gc or maintenance on the shared clone. The module is imported inside each test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

type Env = Record<string, string>;
type Run = { cleanEnv: (base: Env) => Env };

const load = async (): Promise<Run> =>
  (await import(pathToFileURL(join(ROOT, "scripts/corpus-run.mjs")).href)) as unknown as Run;

describe("corpus-run cleanEnv", () => {
  it("AC-6: appends core.hooksPath, gc.auto and maintenance.auto after existing pairs without changing the base", async () => {
    const { cleanEnv } = await load();

    const first: Env = { GIT_DIR: "/somewhere/.git", PATH: "/usr/bin:/bin" };
    const second: Env = {
      PATH: "/usr/bin:/bin",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "a.b",
      GIT_CONFIG_VALUE_0: "1",
      GIT_CONFIG_KEY_1: "c.d",
      GIT_CONFIG_VALUE_1: "2",
    };
    const firstCopy = structuredClone(first);
    const secondCopy = structuredClone(second);

    const one = cleanEnv(first);
    expect(one).not.toHaveProperty("GIT_DIR");
    expect(one.GIT_CONFIG_COUNT).toBe("3");
    expect(one.GIT_CONFIG_KEY_0).toBe("core.hooksPath");
    expect(one.GIT_CONFIG_VALUE_0).toBe("/dev/null");
    expect(one.GIT_CONFIG_KEY_1).toBe("gc.auto");
    expect(one.GIT_CONFIG_VALUE_1).toBe("0");
    expect(one.GIT_CONFIG_KEY_2).toBe("maintenance.auto");
    expect(one.GIT_CONFIG_VALUE_2).toBe("false");

    const two = cleanEnv(second);
    expect(two.GIT_CONFIG_KEY_0).toBe("a.b");
    expect(two.GIT_CONFIG_VALUE_0).toBe("1");
    expect(two.GIT_CONFIG_KEY_1).toBe("c.d");
    expect(two.GIT_CONFIG_VALUE_1).toBe("2");
    expect(two.GIT_CONFIG_KEY_2).toBe("core.hooksPath");
    expect(two.GIT_CONFIG_VALUE_2).toBe("/dev/null");
    expect(two.GIT_CONFIG_KEY_3).toBe("gc.auto");
    expect(two.GIT_CONFIG_VALUE_3).toBe("0");
    expect(two.GIT_CONFIG_KEY_4).toBe("maintenance.auto");
    expect(two.GIT_CONFIG_VALUE_4).toBe("false");
    expect(two.GIT_CONFIG_COUNT).toBe("5");

    expect(first).toEqual(firstCopy);
    expect(second).toEqual(secondCopy);
  });
});
