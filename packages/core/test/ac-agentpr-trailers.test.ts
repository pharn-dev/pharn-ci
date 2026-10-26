import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// parseCoAuthorTrailers is loaded inside each test body, and the fixtures under fixtures/agent-pr/ are read there
// too: the AC tests are written before the build adds them, so nothing the build adds may run while this file loads.

type Trailer = { name: string; email: string };

interface TrailersModule {
  parseCoAuthorTrailers(message: string): Trailer[];
}

const load = async () => (await import("../src/index.js")) as unknown as TrailersModule;

const ROOT = new URL("../../../", import.meta.url);
const agentPrFixture = (name: string) => readFileSync(new URL(`fixtures/agent-pr/${name}`, ROOT), "utf8");

// The first test of a file loads core's index cold, which can take seconds on a loaded host.
describe("agent-pr-detection: parseCoAuthorTrailers", { timeout: 60_000 }, () => {
  it("AC-2: claude-trailer.txt returns the Claude trailer", async () => {
    const { parseCoAuthorTrailers } = await load();
    expect(parseCoAuthorTrailers(agentPrFixture("claude-trailer.txt"))).toEqual([
      { name: "Claude", email: "noreply@anthropic.com" },
    ]);
  });

  it("AC-2: mid-message.txt returns the Cursor trailer although a line follows it", async () => {
    const { parseCoAuthorTrailers } = await load();
    expect(parseCoAuthorTrailers(agentPrFixture("mid-message.txt"))).toEqual([
      { name: "Cursor Agent", email: "cursoragent@cursor.com" },
    ]);
  });

  it("AC-2: devin-noreply.txt returns the Devin noreply trailer", async () => {
    const { parseCoAuthorTrailers } = await load();
    expect(parseCoAuthorTrailers(agentPrFixture("devin-noreply.txt"))).toEqual([
      {
        name: "devin-ai-integration[bot]",
        email: "158243242+devin-ai-integration[bot]@users.noreply.github.com",
      },
    ]);
  });

  it("AC-2: human-coauthor.txt returns the Jane Roe trailer", async () => {
    const { parseCoAuthorTrailers } = await load();
    expect(parseCoAuthorTrailers(agentPrFixture("human-coauthor.txt"))).toEqual([
      { name: "Jane Roe", email: "jane.roe@example.com" },
    ]);
  });

  it("AC-2: plain.txt returns no trailer", async () => {
    const { parseCoAuthorTrailers } = await load();
    expect(parseCoAuthorTrailers(agentPrFixture("plain.txt"))).toEqual([]);
  });

  it("AC-2: a lower-case or upper-case prefix after leading spaces or tabs is read", async () => {
    const { parseCoAuthorTrailers } = await load();
    const message = [
      "Tidy the loader",
      "",
      "  co-authored-by: Lower Case <lower@example.org>",
      "\tCO-AUTHORED-BY: Upper Case <upper@example.org>",
      " \t Co-Authored-By: Mixed Case <mixed@example.org>",
      "",
    ].join("\n");
    expect(parseCoAuthorTrailers(message)).toEqual([
      { name: "Lower Case", email: "lower@example.org" },
      { name: "Upper Case", email: "upper@example.org" },
      { name: "Mixed Case", email: "mixed@example.org" },
    ]);
  });

  it("AC-2: CRLF line ends are read", async () => {
    const { parseCoAuthorTrailers } = await load();
    const message = "Add retry to the upload step\r\n\r\nCo-authored-by: Claude <noreply@anthropic.com>\r\n";
    expect(parseCoAuthorTrailers(message)).toEqual([{ name: "Claude", email: "noreply@anthropic.com" }]);
  });

  it("AC-2: a line without <email> and a Signed-off-by line are skipped", async () => {
    const { parseCoAuthorTrailers } = await load();
    const message = [
      "Rework the cache",
      "",
      "Co-authored-by: Claude",
      "Co-authored-by: Claude noreply@anthropic.com",
      "Co-authored-by: Empty <>",
      "Signed-off-by: Claude <noreply@anthropic.com>",
      "Co-authored-by: Kept Trailer <kept@example.org>",
      "",
    ].join("\n");
    expect(parseCoAuthorTrailers(message)).toEqual([{ name: "Kept Trailer", email: "kept@example.org" }]);
  });

  it("AC-2: a message of 60 trailers returns the first 50", async () => {
    const { parseCoAuthorTrailers } = await load();
    const trailers = Array.from({ length: 60 }, (_, i) => ({
      name: `Agent ${i + 1}`,
      email: `agent${i + 1}@example.org`,
    }));
    const message = `Many hands\n\n${trailers.map((t) => `Co-authored-by: ${t.name} <${t.email}>`).join("\n")}\n`;
    expect(parseCoAuthorTrailers(message)).toEqual(trailers.slice(0, 50));
  });

  it("AC-2: a trailer starting after UTF-16 code unit 65,536 is not returned", async () => {
    const { parseCoAuthorTrailers } = await load();
    const head = "Subject\n\nCo-authored-by: Early Trailer <early@example.org>\n";
    const filler = "x".repeat(66_000);
    const message = `${head}${filler}\nCo-authored-by: Claude <noreply@anthropic.com>\n`;
    expect(message.indexOf("Co-authored-by: Claude")).toBeGreaterThan(65_536);
    expect(parseCoAuthorTrailers(message)).toEqual([{ name: "Early Trailer", email: "early@example.org" }]);
  });

  it("AC-2: the empty string and 1 MiB of < return no trailer without throwing", async () => {
    const { parseCoAuthorTrailers } = await load();
    const lessThans = "<".repeat(1024 * 1024);
    let empty: Trailer[] | undefined;
    let flood: Trailer[] | undefined;
    let prefixedFlood: Trailer[] | undefined;
    expect(() => {
      empty = parseCoAuthorTrailers("");
    }).not.toThrow();
    expect(() => {
      flood = parseCoAuthorTrailers(lessThans);
    }).not.toThrow();
    expect(() => {
      prefixedFlood = parseCoAuthorTrailers(`Co-authored-by: ${lessThans}>`);
    }).not.toThrow();
    expect(empty).toEqual([]);
    expect(flood).toEqual([]);
    expect(prefixedFlood).toEqual([]);
  });
});
