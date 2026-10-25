import { describe, expect, it } from "vitest";
import { messagesOf, runDiff } from "./ac-e1-fix-shared.js";

// The selector and check() are loaded inside the test body: the AC tests are written before the pytest config files
// are selected, so nothing the build adds may run while the file loads.

type KeepText = (file: { path: string; oldPath: string }) => boolean;
type SelectorFactory = (configPath?: string, repoRoot?: string) => KeepText;

const CODE = "TEST_INTEGRITY_TEXT_TRUNCATED";

const SELECTED = ["pytest.ini", "pkg/pyproject.toml", "setup.cfg", "tox.ini"];
const NOT_SELECTED = ["docs/setup.cfg.md"];

/** A modified file that adds `lines` after line 10. */
function addLines(path: string, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, `@@ -10,0 +11,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n")}\n`;
}

describe("the diff reader keeps the text of pytest config files", () => {
  it("AC-6: the exported selector keeps pytest.ini, pkg/pyproject.toml, setup.cfg and tox.ini but not docs/setup.cfg.md, and a cut pyproject.toml is named in TEST_INTEGRITY_TEXT_TRUNCATED", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Record<string, unknown>;
    const factory = core.keepSignalFileText as SelectorFactory;
    expect(typeof factory).toBe("function");
    const keepText = factory();
    for (const path of SELECTED) expect(keepText({ path, oldPath: path }), path).toBe(true);
    for (const path of NOT_SELECTED) expect(keepText({ path, oldPath: path }), path).toBe(false);

    const bound = core.MAX_KEPT_LINES as number;
    expect(typeof bound).toBe("number");
    const lines = Array.from({ length: bound + 1 }, (_, i) => `key_${i + 1} = "v"`);
    const messages = messagesOf(await runDiff(addLines("pyproject.toml", lines)), CODE);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toContain("`pyproject.toml`");
  });
});
