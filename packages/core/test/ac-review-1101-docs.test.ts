import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Docs pins for the 2026-11-01 review: each sentence it found untrue stays fixed.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const flat = (text: string) => text.replace(/\s+/g, " ");

describe("docs say what the code does (review 2026-11-01)", () => {
  it("README: nothing phones home only without id-token: write; precedence does not claim the config can only tighten", () => {
    const readme = flat(read("README.md"));
    expect(readme).toContain("nothing in it phones home unless the job grants `id-token: write`");
    expect(readme).not.toContain("`.pharn/ci.yml` can only tighten");
    // Updated for fix/ci-yml-only-tightens: the threshold and setup.require now merge to the stricter value too, so
    // the sentence names all three and what an input still replaces; the blanket claim above stays absent.
    expect(readme).toContain(
      "`coverage.threshold` (the larger value applies), `setup.require` (`true` wins) and the test-integrity mode are merged to the stricter value",
    );
    expect(readme).toContain("An input still replaces the config's `file`, `root` and `format`");
    expect(readme).not.toContain("fully stateless");
  });

  it("README: the AI-agnostic sentence names the P11 exception", () => {
    const readme = flat(read("README.md"));
    const at = readme.indexOf("It is **AI-agnostic**");
    expect(at).toBeGreaterThan(-1);
    expect(readme.slice(at, at + 500)).toContain("P11");
  });

  it("SECURITY.md best practices name what id-token: write turns on", () => {
    const practices = flat(read("SECURITY.md").split("## Security best practices for users")[1] ?? "");
    expect(practices).toContain("id-token: write");
    expect(practices).toContain("upload");
  });

  it("THREAT-MODEL: §1 names the app and the OIDC token; §3 has the threshold item", () => {
    const threat = read("docs/THREAT-MODEL.md");
    const trust = flat(threat.split("## 1. Trust assumptions")[1]?.split("## 2.")[0] ?? "");
    expect(trust).toContain("OIDC token");
    expect(trust).toContain("`app-url`");
    expect(threat).toContain("37. **The threshold comes from the PR.**");
  });

  it("LIMITS: §1 points at TI02, TI05 and TI06, P01 has a misses section, fail-on-threshold covers every fail", () => {
    const limits = read("docs/LIMITS.md");
    const one = flat(limits.split("## 1. What diff coverage measures")[1]?.split("### What TI02 misses")[0] ?? "");
    expect(one).not.toContain("not detected yet");
    expect(one).not.toContain("in a later release");
    expect(limits).toContain("### What P01 misses");
    expect(flat(limits)).toContain("it covers every cause of a `fail` verdict");
  });

  it("action.yml: fail-on-threshold and github-token say what they cover", () => {
    const action = read("action.yml");
    expect(action).toContain("whatever made it fail");
    expect(action).toContain("an empty or under-scoped token makes that detection fail closed");
  });

  it("MARKETPLACE.md does not claim a listing that does not exist", () => {
    const listing = read("docs/MARKETPLACE.md");
    expect(listing).not.toContain("it is refreshed on each release");
    expect(listing).toContain("not listed on the Marketplace yet");
  });

  it("Release verify refuses a HEAD that is not the release merge commit", () => {
    const release = read(".github/workflows/release.yml");
    expect(release).toContain('SUBJECT="$(git log -1 --format=%s)"');
    expect(release).toContain("^chore:\\ release\\ ");
  });

  it("AGENTS.md names Report v2 and the opt-in pharn.dev calls", () => {
    const agents = flat(read("AGENTS.md"));
    expect(agents).not.toContain("fully stateless (Phase 0)");
    expect(agents).toContain("`schema/report.v2.json` is the source of truth");
    expect(agents).toContain("python3");
  });
});
