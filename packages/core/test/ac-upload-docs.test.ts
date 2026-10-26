import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The documents are read inside each test body: the build edits them after this test. The base is main at f563d7d,
// read with git.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(new URL(path, `file://${ROOT}`), "utf8").replace(/\r\n/g, "\n");
const BASE = "f563d7d";
const atBase = (path: string) =>
  execFileSync("git", ["show", `${BASE}:${path}`], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).replace(/\r\n/g, "\n");

const RESIDUAL_27 = "**On a same-repository PR the PR's code runs in the job that can mint the upload token.**";

/** The lines after the first line matching `start` and before the next line matching `end` (to the end if none). */
function between(lines: string[], start: (line: string) => boolean, end: (line: string) => boolean): string[] {
  const from = lines.findIndex(start);
  if (from === -1) return [];
  const rest = lines.slice(from + 1);
  const to = rest.findIndex(end);
  return to === -1 ? rest : rest.slice(0, to);
}

/** The lines under the exact `## <heading>` line up to the next `## ` heading, outside fenced code blocks. */
function section(markdown: string, heading: string): string[] {
  const lines = markdown.split("\n");
  const at = lines.indexOf(`## ${heading}`);
  expect(at, `section "## ${heading}"`).toBeGreaterThanOrEqual(0);
  const out: string[] = [];
  let fenced = false;
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith("```")) fenced = !fenced;
    if (!fenced && line.startsWith("## ")) break;
    out.push(line);
  }
  return out;
}

/** The `## ` headings of a markdown text, in order, outside fenced code blocks. */
function headings(markdown: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    if (!fenced && line.startsWith("## ")) out.push(line);
  }
  return out;
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

/** action.yml inputs or outputs: name -> the lines of its entry. */
function yamlSection(text: string, name: "inputs" | "outputs"): Map<string, string[]> {
  const lines = between(
    text.split("\n"),
    (l) => l === `${name}:`,
    (l) => /^\S/.test(l),
  );
  const entries = new Map<string, string[]>();
  let current: string | undefined;
  for (const line of lines) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      current = m[1] as string;
      entries.set(current, []);
    } else if (current !== undefined && line.startsWith("    ")) {
      entries.get(current)?.push(line.trim());
    }
  }
  return entries;
}

const defaultOf = (entry: string[] | undefined) =>
  entry
    ?.find((l) => l.startsWith("default:"))
    ?.slice("default:".length)
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2");

/** The §2 table rows and the §3 numbered residuals of THREAT-MODEL.md. */
function threatModel(text: string) {
  const lines = text.split("\n");
  const rows = between(
    lines,
    (l) => l.startsWith("## 2."),
    (l) => l.startsWith("## 3."),
  ).filter((l) => l.startsWith("| "));
  const residuals = numberedItems(
    between(
      lines,
      (l) => l.startsWith("## 3."),
      (l) => l.startsWith("## 4."),
    ),
  );
  return { rows, residuals };
}

const row = (rows: string[], id: string) => rows.find((r) => new RegExp(`^\\| ${id} +\\|`).test(r));
const boldTitle = (text: string) => /^\d+\. (\*\*.+?\*\*)/s.exec(text)?.[1];

/** The `### <name>` subsections of CHANGELOG's Unreleased section: name -> bullets. */
function unreleased(changelog: string): Map<string, string[]> {
  const lines = between(
    changelog.split("\n"),
    (l) => l.startsWith("## [Unreleased]"),
    (l) => l.startsWith("## ["),
  );
  const out = new Map<string, string[]>();
  let name: string | undefined;
  let block: string[] = [];
  const flush = () => {
    if (name !== undefined) out.set(name, bullets(block));
  };
  for (const line of lines) {
    if (line.startsWith("### ")) {
      flush();
      name = line.slice(4).trim();
      block = [];
    } else block.push(line);
  }
  flush();
  return out;
}

// git is spawned for the base texts, which can take seconds on a loaded host.
describe("upload documentation", { timeout: 60_000 }, () => {
  it("AC-34: action.yml declares the upload input (default auto) with its description, and the run-url output", () => {
    const actionYml = read("action.yml");
    const inputs = yamlSection(actionYml, "inputs");
    expect(inputs.has("upload")).toBe(true);
    const upload = inputs.get("upload");
    expect(defaultOf(upload)).toBe("auto");
    const description = (upload ?? []).filter((l) => !l.startsWith("default:") && !l.startsWith("required:")).join(" ");
    expect(description).toContain("id-token: write");
    expect(description).toContain("Pharn GitHub App");
    expect(description).toContain("never");
    expect(description).toContain(".pharn/ci.yml");
    expect(description).toMatch(/\bnot\b[^.]*\.pharn\/ci\.yml/i);
    expect(yamlSection(actionYml, "outputs").has("run-url")).toBe(true);
  });

  it("AC-35: README has the upload, run-url and UPLOAD_TOO_LARGE rows and an Upload to pharn.dev section right after Org policy, linked from Contents", () => {
    const readme = read("README.md");
    const lines = readme.split("\n");
    expect(
      lines.some((l) => /^\| `upload` +\|/.test(l)),
      "inputs row",
    ).toBe(true);
    expect(
      lines.some((l) => /^\| `run-url` +\|/.test(l)),
      "outputs row",
    ).toBe(true);
    expect(
      lines.some((l) => /^\| `UPLOAD_TOO_LARGE` +\|/.test(l)),
      "message-code row",
    ).toBe(true);

    const all = headings(readme);
    const orgPolicy = all.indexOf("## Org policy");
    expect(orgPolicy).toBeGreaterThan(-1);
    expect(all[orgPolicy + 1]).toBe("## Upload to pharn.dev (optional)");

    const contents = section(readme, "Contents");
    expect(contents.some((l) => l.includes("(#upload-to-pharndev-optional)"))).toBe(true);

    const body = section(readme, "Upload to pharn.dev (optional)").join("\n");
    expect(body).toContain("id-token: write");
    expect(body).toMatch(/\bjob\b/i);
    expect(body).toContain("report.json");
    expect(body).toContain("meta.json");
    expect(body).toMatch(/never/i);
    expect(body).toMatch(/file contents/i);
    expect(body).toMatch(/diffs?/i);
    expect(body).toMatch(/coverage files?/i);
    expect(body).toMatch(/\blogs?\b/i);
    expect(body).toMatch(/fail-open|fails open|never fails/i);
    expect(body).toContain("pharn[bot]");
    expect(body).toMatch(/hint/i);
    expect(body).toContain("upload");
  });

  it("AC-36: THREAT-MODEL has row D7 Upload to pharn.dev, D1 names the upload, residual 27 has its title, and residuals 1 to 26, A1 and B1 are the base's", () => {
    const head = threatModel(read("docs/THREAT-MODEL.md"));
    const base = threatModel(atBase("docs/THREAT-MODEL.md"));

    const d7 = row(head.rows, "D7");
    expect(d7).toBeDefined();
    expect(d7).toContain("Upload to pharn.dev");

    const d1 = row(head.rows, "D1") ?? "";
    const sentence = /No network calls other than[^.]*\./.exec(d1)?.[0] ?? "";
    expect(sentence.length).toBeGreaterThan(0);
    expect(sentence).toMatch(/upload/i);
    const baseSentence = /No network calls other than[^.]*\./.exec(row(base.rows, "D1") ?? "")?.[0] ?? "";
    expect(baseSentence, "control: the base sentence does not name the upload").not.toMatch(/upload/i);

    for (const id of ["A1", "B1"]) {
      expect(row(base.rows, id), `control: base ${id}`).toBeDefined();
      expect(row(head.rows, id), id).toBe(row(base.rows, id));
    }

    const baseTitles = base.residuals.map((r) => [r.n, boldTitle(r.text)]);
    expect(baseTitles.at(-1)?.[0], "control: the base ends at residual 26").toBe(26);
    const headTitles = head.residuals.map((r) => [r.n, boldTitle(r.text)]);
    expect(headTitles.slice(0, baseTitles.length)).toEqual(baseTitles);
    const r27 = head.residuals.find((r) => r.n === 27);
    expect(r27).toBeDefined();
    expect(boldTitle(r27?.text ?? "")).toBe(RESIDUAL_27);
    expect(headTitles[baseTitles.length]?.[0]).toBe(27);
  });

  it("AC-37: LIMITS has the Upload to pharn.dev section, SECURITY and MARKETPLACE name the upload, and CHANGELOG has one new Added and one new Security bullet", () => {
    const limits = section(read("docs/LIMITS.md"), "Upload to pharn.dev").join("\n");
    expect(limits).toMatch(/connect timeout/i);
    expect(limits).toMatch(/matrix/i);
    expect(limits).toContain("scope");
    expect(limits).toContain("404");
    expect(limits).toMatch(/hint/i);
    expect(limits).toContain("CLI");
    expect(limits).toContain("413");

    const security = read("SECURITY.md");
    expect(security).toMatch(/upload/i);
    expect(security).toContain("id-token: write");
    expect(security).toContain("upload: never");

    const marketplace = read("docs/MARKETPLACE.md");
    expect(marketplace).toMatch(/upload/i);
    expect(marketplace).toContain("id-token: write");
    expect(marketplace).toContain("upload: never");
    const paragraphs = section(marketplace, "Description")
      .join("\n")
      .trim()
      .split(/\n[ \t]*\n/)
      .map((p) => p.trim())
      .filter((p) => p !== "");
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs.join("\n")).toContain("upload: never");

    const head = unreleased(read("CHANGELOG.md"));
    const base = unreleased(atBase("CHANGELOG.md"));
    const fresh = (name: string) => (head.get(name) ?? []).filter((b) => !(base.get(name) ?? []).includes(b));
    // Re-pinned for E3 item 22 (policy rules): Unreleased also gains exactly one Added bullet for the org policy rules,
    // which names POLICY_P08; it is asserted here and set aside, and the upload bullet is judged as before.
    const policyRuleBullets = fresh("Added").filter((b) => b.startsWith("- Org policy rules P01, P08, P09 and P10."));
    expect(policyRuleBullets).toHaveLength(1);
    expect(policyRuleBullets[0]).toContain("POLICY_P08");
    const addedBullets = fresh("Added").filter((b) => !policyRuleBullets.includes(b));
    const securityBullets = fresh("Security");
    expect(addedBullets).toHaveLength(1);
    expect(securityBullets).toHaveLength(1);
    for (const bullet of [...addedBullets, ...securityBullets]) expect(bullet).not.toContain("OIDC");
    expect(addedBullets[0]).toContain("upload");
    expect(addedBullets[0]).toContain("run-url");
    expect(addedBullets[0]).toContain("UPLOAD_TOO_LARGE");
    expect(addedBullets[0]).toContain("upload-meta.v1.json");
    expect(securityBullets[0]).toContain("id-token: write");
  });
});
