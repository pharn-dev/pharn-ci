import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// precision-corpus-freeze: the bot classifier of scripts/corpus-freeze.mjs over the recorded REST pull objects in
// fixtures/corpus-freeze/classify.json (synthetic logins). The script and the fixture are loaded inside the test
// body, so before the build the test fails rather than the file failing to load.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = pathToFileURL(`${ROOT}scripts/corpus-freeze.mjs`).href;

type Pull = { number: number; user: { login?: string; type?: string } | null };

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("precision-corpus-freeze: isBot", () => {
  it("AC-4: isBot is true for Bot-type authors, [bot] logins and renovate/dependabot logins, false for everyone else", async () => {
    const { isBot } = await import(SCRIPT);
    const pulls = JSON.parse(readFileSync(`${ROOT}fixtures/corpus-freeze/classify.json`, "utf8")) as Pull[];

    const logins = pulls.map((pull) => pull.user?.login);
    expect(pulls.some((pull) => pull.user?.type === "Bot")).toBe(true);
    expect(logins.some((login) => login?.endsWith("[bot]"))).toBe(true);
    for (const login of [
      "renovate",
      "Renovate-Bot",
      "dependabot-preview",
      "DEPENDABOT",
      "botanist",
      "robot-fan",
      "not-renovate",
    ]) {
      expect(logins, `fixture holds ${login}`).toContain(login);
    }
    expect(pulls.some((pull) => pull.user === null)).toBe(true);

    const byRule = (pull: Pull) => {
      if (pull.user?.type === "Bot") return true;
      const login = pull.user?.login;
      if (typeof login !== "string") return false;
      if (login.endsWith("[bot]")) return true;
      const lower = login.toLowerCase();
      return lower.startsWith("renovate") || lower.startsWith("dependabot");
    };
    for (const pull of pulls) {
      expect(isBot(pull), `#${pull.number} (${pull.user?.login ?? "no author"})`).toBe(byRule(pull));
    }

    const numbers = new Set(pulls.map((pull) => pull.number));
    const result = (n: number) => isBot(pulls.find((pull) => pull.number === n));
    for (const n of range(101, 107)) {
      expect(numbers.has(n), `fixture holds #${n}`).toBe(true);
      expect(result(n), `#${n} is a bot`).toBe(true);
    }
    for (const n of [...range(108, 112), ...range(120, 129)]) {
      expect(numbers.has(n), `fixture holds #${n}`).toBe(true);
      expect(result(n), `#${n} is not a bot`).toBe(false);
    }
  });
});
