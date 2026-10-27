import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The documents are read inside the test body: the build edits them, after this test.

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
/** The bold title of each THREAT-MODEL §3 residual at the base commit 3ed722f (there is no residual 7). */
const RESIDUAL_TITLES: Array<[number, string]> = [
  [1, "**pharn-ci trusts the coverage file.**"],
  [2, "**Coverage and config paths are not confined**"],
  [3, "**The PR's code shares the job.**"],
  [4, "**A compromised build dependency could alter the bundle**"],
  [5, "**No input size caps**"],
  [6, "**Exclusions come from the PR.**"],
  [8, "**The agent setup requirement comes from the PR.**"],
  [9, "**The coverage root comes from the PR.**"],
  [10, "**One maintainer, so every two-person control is procedural**"],
  [11, "**Agent setup expectations come from the PR.**"],
  [12, "**The test-integrity mode can be set from the PR.**"],
  [13, "**TI01 reads the text of the PR's diff.**"],
  [14, "**TI14 and TI11 read the PR-controlled config and workflow files.**"],
  [15, "**TI03 and TI04 read the kept text of test files.**"],
  [16, "**TI10 and TI13 make the diff reader keep the text of source files and `package.json`.**"],
  [17, "**The accept label is only as honest as the workflow file that names it.**"],
  [18, "**The text of the PR's test and test-config files is read into memory and parsed by `check()`**"],
  [19, "**The test index parses the text of the PR's test files with TypeScript's parser.**"],
  [20, "**The Python test index runs the runner's own `python3` on the text of the PR's Python test files**"],
  [21, "**A policy document's duplicate keys are invisible to validation**"],
];
const CLOSED_BY_APP_POLICY = [6, 8, 9, 11, 12];

/** The lines after the first line matching `start` and before the next line matching `end` (to the end if none). */
function between(lines: string[], start: (line: string) => boolean, end: (line: string) => boolean): string[] {
  const from = lines.findIndex(start);
  if (from === -1) return [];
  const rest = lines.slice(from + 1);
  const to = rest.findIndex(end);
  return to === -1 ? rest : rest.slice(0, to);
}

/** Each numbered item (`^\d+\. `) of a list, with its number, joined with its indented continuation lines. */
function numberedItems(lines: string[]): Array<{ n: number; text: string }> {
  const items: Array<{ n: number; text: string }> = [];
  let current: { n: number; lines: string[] } | undefined;
  const flush = () => {
    if (current !== undefined) items.push({ n: current.n, text: current.lines.join("\n") });
    current = undefined;
  };
  for (const line of lines) {
    const m = /^(\d+)\. /.exec(line);
    if (m) {
      flush();
      current = { n: Number(m[1]), lines: [line] };
    } else if (current !== undefined && /^\s+\S/.test(line)) {
      current.lines.push(line);
    } else {
      flush();
    }
  }
  flush();
  return items;
}

/** Each `- ` bullet joined with its indented continuation lines. */
function bullets(lines: string[]): string[] {
  const out: string[] = [];
  let current: string[] | undefined;
  for (const line of lines) {
    if (line.startsWith("- ")) {
      if (current) out.push(current.join(" "));
      current = [line];
    } else if (current && /^\s+\S/.test(line)) {
      current.push(line.trim());
    } else if (current) {
      out.push(current.join(" "));
      current = undefined;
    }
  }
  if (current) out.push(current.join(" "));
  return out;
}

/**
 * The lines under the markdown heading at `at`, up to the next heading of the same or a higher level; lines inside
 * fenced code blocks (YAML comments start with `#`) are never taken for headings.
 */
function sectionAt(lines: string[], at: number): string[] {
  const level = /^(#+) /.exec(lines[at] ?? "")?.[1]?.length ?? 0;
  const out: string[] = [];
  let fenced = false;
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith("```")) fenced = !fenced;
    const heading = fenced ? null : /^(#+) /.exec(line);
    if (heading && (heading[1]?.length ?? 0) <= level) break;
    out.push(line);
  }
  return out;
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

describe("org policy documentation and metadata", () => {
  it("AC-28: action.yml, README, AGENTS.md, THREAT-MODEL, LIMITS, CHANGELOG, the schemas, the hints and the manifests describe the org policy", () => {
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

    // README.
    const readme = read("README.md");
    const readmeLines = readme.split("\n");
    const policyRow = readmeLines.find((l) => /^\| `policy` +\|/.test(l));
    const appUrlRow = readmeLines.find((l) => /^\| `app-url` +\|/.test(l));
    expect(policyRow).toBeDefined();
    expect(policyRow).toContain("`auto`");
    expect(appUrlRow).toBeDefined();
    expect(appUrlRow).toContain("https://pharn.dev");
    const quickStart = between(
      readmeLines,
      (l) => l === "## Quick start",
      (l) => l.startsWith("## "),
    ).join("\n");
    expect(quickStart).toMatch(/permissions:[\s\S]*id-token: write/);
    const orgPolicyHeading = readmeLines.findIndex((l) => /^#{2,4} Org policy\b/.test(l));
    expect(orgPolicyHeading).toBeGreaterThan(-1);
    const orgPolicy = sectionAt(readmeLines, orgPolicyHeading).join("\n");
    expect(orgPolicy).toContain("OIDC");
    expect(orgPolicy).toMatch(/only the OIDC token and the repo(sitory)? name/i);
    expect(orgPolicy).toContain(".pharn/ci.yml");
    expect(orgPolicy).toMatch(/workflow inputs?/i);
    expect(orgPolicy).toContain("file:");
    expect(orgPolicy).toMatch(/tighten/i);
    expect(orgPolicy).toContain("app-url");
    expect(orgPolicy).toMatch(/https/);
    expect(readmeLines.some((l) => l.startsWith("| `POLICY_UNAVAILABLE`"))).toBe(true);
    expect(readmeLines.some((l) => l.startsWith("| `POLICY_OVERRIDE_IGNORED`"))).toBe(true);

    // AGENTS.md rule 5.
    const agentsRules = between(
      read("AGENTS.md").split("\n"),
      (l) => l === "## Rules",
      (l) => l.startsWith("## "),
    );
    const rule5 = numberedItems(agentsRules).find((item) => item.n === 5)?.text ?? "";
    expect(rule5).toContain("pharn.dev");
    expect(rule5).toMatch(/policy/);
    expect(rule5).toContain("auto");
    expect(rule5).toContain("required");
    expect(rule5).toContain("OIDC");

    // THREAT-MODEL §2.
    const threatModel = read("docs/THREAT-MODEL.md").split("\n");
    const rows = between(
      threatModel,
      (l) => l.startsWith("## 2."),
      (l) => l.startsWith("## 3."),
    ).filter((l) => l.startsWith("| "));
    expect(rows.some((r) => r.includes("/api/v1/policy"))).toBe(true);
    expect(rows.some((r) => r.includes("OIDC") && /token/i.test(r))).toBe(true);
    expect(rows.some((r) => r.includes("validatePolicyResponse"))).toBe(true);
    expect(rows.some((r) => r.includes("`file:`") && r.includes("readPolicyFile"))).toBe(true);
    const a4 = rows.find((r) => /^\| A4 /.test(r));
    expect(a4).toBeDefined();
    expect(a4).not.toContain("not read by the Action or the CLI");
    const d1 = rows.find((r) => /^\| D1 /.test(r));
    expect(d1).toBeDefined();
    expect(d1).not.toMatch(/No network calls other than the GitHub API[;.]/);

    // THREAT-MODEL §3: numbers and titles kept, 6/8/9/11/12 closed by an app policy, new residuals from 22.
    const residuals = numberedItems(
      between(
        threatModel,
        (l) => l.startsWith("## 3."),
        (l) => l.startsWith("## 4."),
      ),
    );
    const numbers = residuals.map((r) => r.n);
    expect(numbers.slice(0, RESIDUAL_TITLES.length)).toEqual(RESIDUAL_TITLES.map(([n]) => n));
    expect(numbers.length).toBeGreaterThan(RESIDUAL_TITLES.length);
    expect(numbers.slice(RESIDUAL_TITLES.length)).toEqual(
      Array.from({ length: numbers.length - RESIDUAL_TITLES.length }, (_, i) => 22 + i),
    );
    for (const [n, title] of RESIDUAL_TITLES) {
      const item = residuals.find((r) => r.n === n);
      expect(item?.text.startsWith(`${n}. ${title}`), `residual ${n}`).toBe(true);
    }
    for (const n of CLOSED_BY_APP_POLICY) {
      const text = residuals.find((r) => r.n === n)?.text ?? "";
      expect(text, `residual ${n}`).toMatch(/closed/i);
      expect(text, `residual ${n}`).toMatch(/app policy/i);
    }

    // LIMITS.
    const limits = read("docs/LIMITS.md");
    expect(limits).toMatch(/ETag/);
    expect(limits).toMatch(/persistent/i);
    expect(limits).toMatch(/connect timeout/i);
    expect(limits).toContain("id-token: write");
    expect(limits).toMatch(/fork/i);
    expect(limits).toMatch(/tighten/i);

    // CHANGELOG: one Unreleased line for the org policy.
    const unreleased = between(
      read("CHANGELOG.md").split("\n"),
      (l) => l.startsWith("## [0.4.0] - 2026-10-27"),
      (l) => l.startsWith("## ["),
    );
    expect(bullets(unreleased).filter((b) => b.includes("OIDC") && /policy/.test(b))).toHaveLength(1);

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
