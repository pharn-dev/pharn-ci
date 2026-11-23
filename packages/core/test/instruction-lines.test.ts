import { describe, expect, it } from "vitest";
import { hasCueWord, SHELL_INFO, shellLine } from "../src/setup/instructionLines.js";
import { instructionDeclarations } from "../src/setup/instructions.js";
import { scanInstructionTokens } from "../src/setup/staleScan.js";
import { fixture } from "./helpers.js";

// CORE-142 group 1: P07's declarations (instructions.ts) and the stale instruction scan (staleScan.ts) share one module
// of line helpers. Three of them had drifted apart; each now has one behaviour, the one that reads more, pinned here by
// a fixture for each scan. The fixtures are stored as .txt so the inventory never lists them as instruction files.

const commandsOf = (text: string) =>
  scanInstructionTokens(text).commands.map((c) => `${c.line} ${c.manager} ${c.name}`);

describe("the shared instruction-line helpers", () => {
  it("the stale scan reads a PowerShell prompt, PowerShell and cmd fences, a cue word next to a non-ASCII letter, and assignments as before", () => {
    expect(commandsOf(fixture("instruction-lines/tokens.md.txt"))).toEqual([
      // shellLine: a `PS …> ` prompt in a console block (was read by P07 only).
      "4 pnpm ps-session",
      "5 make ps-target",
      // SHELL_INFO: powershell and cmd fences are shell (were read by P07 only).
      "10 npm ps-fence",
      "14 yarn cmd-fence",
      // hasCueWord: "Noël" is one word, not the cue "no" (the stale scan split words at every non-ASCII letter).
      "17 pnpm before-noel",
      // isAssignment: the same rule in both scans; `1FOO=x` is not an assignment, so its line names no command.
      "23 pnpm env-assigned",
    ]);
  });

  it("P07 reads a span after a dotted word that only starts with a cue word, a non-ASCII word, a cmd fence and a PowerShell prompt", () => {
    expect(instructionDeclarations(fixture("instruction-lines/declarations.md.txt"))).toEqual({
      patternScoped: false,
      // hasCueWord: `docs/not.md` holds the word `not.md`, not the cue `not` (P07 split words at every dot).
      packageManagers: { tools: ["npm", "pnpm", "bun"], line: 3 },
      testRunners: { tools: ["vitest"], line: 12 },
    });
  });

  it("hasCueWord: words of any script, dots inside a word, trailing dots and apostrophes dropped", () => {
    const cues = new Set(["not", "no", "e.g", "dont"]);
    const has = (text: string) => hasCueWord(text, 0, text.length, cues);
    expect(has("Do not.")).toBe(true);
    expect(has("e.g. this")).toBe(true);
    expect(has("dont' do")).toBe(true);
    expect(has("Do NOT")).toBe(true);
    expect(has("docs/not.md")).toBe(false);
    expect(has("before Noël")).toBe(false);
    expect(has("nö")).toBe(false);
    // Only the gap [from, to) is read.
    expect(hasCueWord("not here", 4, 8, cues)).toBe(false);
  });

  it("shellLine: prompts, PowerShell prompts in a session only, and comments", () => {
    expect(shellLine("  $ pnpm build", true)).toBe("pnpm build");
    expect(shellLine("PS C:\\repo> pnpm build", true)).toBe("pnpm build");
    expect(shellLine("PS C:\\repo>pnpm build", true)).toBeNull();
    expect(shellLine(`PS ${"x".repeat(70)}> pnpm build`, true)).toBeNull();
    expect(shellLine("pnpm build", true)).toBeNull();
    expect(shellLine("pnpm build", false)).toBe("pnpm build");
    expect(shellLine("$ # pnpm build", false)).toBeNull();
    expect(shellLine("  # pnpm build", false)).toBeNull();
    expect(shellLine("PS C:\\repo> pnpm build", false)).toBe("PS C:\\repo> pnpm build");
    expect([...SHELL_INFO]).toEqual(expect.arrayContaining(["powershell", "pwsh", "ps1", "cmd", "bat"]));
  });
});
