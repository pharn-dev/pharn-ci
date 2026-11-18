import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The files are read inside the test body: the build edits them, after this test. (CORE-133: the README, AGENTS.md,
// THREAT-MODEL, LIMITS and CHANGELOG wording checks moved out; docs-contract.test.ts checks the README input and code
// rows.)

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

/** sha256 of schema/report.v1.json at the base commit 3ed722f. */
const V1_AT_BASE = "c6cfd5b5afeada776fa89028f5ef29e06427d0e32529420184474e52ca77c731";
/** The outputs action.yml declares at the base commit 3ed722f. */
const OUTPUTS_AT_BASE = ["diff-coverage", "report-path", "verdict"];
/** The runtime dependencies of each package manifest at the base commit 3ed722f. */
const DEPENDENCIES_AT_BASE: Record<string, Record<string, string>> = {
  "package.json": {},
  "packages/action/package.json": { "@actions/core": "^3.0.1", "@actions/github": "^9.1.1" },
  "packages/cli/package.json": {},
  "packages/core/package.json": { typescript5: "npm:typescript@5.9.3" },
  "packages/node-io/package.json": {},
};

/** The lines after the first line matching `start` and before the next line matching `end` (to the end if none). */
function between(lines: string[], start: (line: string) => boolean, end: (line: string) => boolean): string[] {
  const from = lines.findIndex(start);
  if (from === -1) return [];
  const rest = lines.slice(from + 1);
  const to = rest.findIndex(end);
  return to === -1 ? rest : rest.slice(0, to);
}

/** action.yml inputs or outputs: name -> the lines of its entry. */
function yamlSection(text: string, section: "inputs" | "outputs"): Map<string, string[]> {
  const lines = between(
    text.split("\n"),
    (l) => l === `${section}:`,
    (l) => /^\S/.test(l),
  );
  const entries = new Map<string, string[]>();
  let name: string | undefined;
  for (const line of lines) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      name = m[1] as string;
      entries.set(name, []);
    } else if (name !== undefined && line.startsWith("    ")) {
      entries.get(name)?.push(line.trim());
    }
  }
  return entries;
}

const defaultOf = (entry: string[] | undefined) => {
  const line = entry?.find((l) => l.startsWith("default:"));
  return line
    ?.slice("default:".length)
    .trim()
    .replace(/^"(.*)"$/, "$1");
};

/** Every string in a JSON value. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value !== null && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

describe("org policy metadata", () => {
  it("AC-28: action.yml, the schemas, the hints and the manifests describe the org policy", () => {
    // action.yml: the two inputs with their defaults, and no new output.
    const actionYml = read("action.yml");
    const inputs = yamlSection(actionYml, "inputs");
    expect(inputs.has("policy")).toBe(true);
    expect(inputs.has("app-url")).toBe(true);
    expect(defaultOf(inputs.get("policy"))).toBe("auto");
    expect(defaultOf(inputs.get("app-url"))).toBe("https://pharn.dev");
    // Re-pinned for the run upload (E3 item 21), which adds exactly the `run-url` output: it must be declared, and with
    // it set aside the outputs are the base's.
    const outputsNow = [...yamlSection(actionYml, "outputs").keys()].sort();
    expect(outputsNow).toContain("run-url");
    expect(outputsNow.filter((name) => name !== "run-url")).toEqual(OUTPUTS_AT_BASE);

    // schema/report.v2.json: the two codes inside the one appended "Codes added in v0.4.0:" text.
    const v2Text = read("schema/report.v2.json");
    expect(v2Text.split(" Codes added in v0.4.0:").length - 1).toBe(1);
    const description = strings(JSON.parse(v2Text)).find((s) => s.includes(" Codes added in v0.4.0:")) ?? "";
    const appended = description.slice(description.indexOf(" Codes added in v0.4.0:"));
    const unavailableAt = appended.indexOf("POLICY_UNAVAILABLE");
    const ignoredAt = appended.indexOf("POLICY_OVERRIDE_IGNORED");
    expect(unavailableAt).toBeGreaterThan(-1);
    expect(ignoredAt).toBeGreaterThan(-1);
    const afterUnavailable = appended.slice(unavailableAt, unavailableAt + 160);
    expect(afterUnavailable).toContain("warn");
    expect(afterUnavailable).toContain("error");
    expect(appended.slice(ignoredAt, ignoredAt + 160)).toContain("warn");

    // schema/report.v1.json is the base's.
    expect(
      createHash("sha256")
        .update(readFileSync(new URL("schema/report.v1.json", ROOT)))
        .digest("hex"),
    ).toBe(V1_AT_BASE);

    // MESSAGE_HINTS has an entry for each new code.
    const markdown = read("packages/core/src/render/markdown.ts");
    const hintsAt = markdown.indexOf("MESSAGE_HINTS");
    expect(hintsAt).toBeGreaterThan(-1);
    const hints = markdown.slice(hintsAt);
    expect(hints).toMatch(/\bPOLICY_UNAVAILABLE\s*:/);
    expect(hints).toMatch(/\bPOLICY_OVERRIDE_IGNORED\s*:/);

    // No runtime dependency was added to any package manifest.
    for (const [manifest, dependencies] of Object.entries(DEPENDENCIES_AT_BASE)) {
      const parsed = JSON.parse(read(manifest)) as Record<string, Record<string, string> | undefined>;
      expect(parsed.dependencies ?? {}, manifest).toEqual(dependencies);
      expect(parsed.optionalDependencies ?? {}, manifest).toEqual({});
      expect(parsed.peerDependencies ?? {}, manifest).toEqual({});
    }
  });
});
