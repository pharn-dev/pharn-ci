// Fails if any GitHub Actions workflow uses a third-party action that is not pinned to a full
// 40-character commit SHA. A tag such as @v4 can be moved to point at different code; a SHA cannot.
// Local actions (./...) are fine. Run from the repo root: node scripts/check-action-pins.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dirs = [".github/workflows", ".github/actions"];
const SHA = /^[0-9a-f]{40}$/;
// Every `uses` key on a line: plain or quoted, at the start of the line, after `-`, or inside a flow mapping such as
// `- { uses: actions/checkout@v4 }`. A false positive (a quoted string that holds "uses:") is preferred over a miss.
const USES = /(?:^|[\s{,-])["']?uses["']?\s*:\s*['"]?([^\s'"#,}]+)/g;
// A line that opens a block scalar (`run: |`, `script: >-`, `- |`): its more-indented lines are text, not keys.
const BLOCK_SCALAR = /^([ \t]*)((?:-[ \t]+)*)(.*)$/;
const BLOCK_INDICATOR = /(?:^|:[ \t])[ \t]*[|>][0-9+-]*$/;
const bad = [];

/**
 * The line without a YAML comment: a `#` at the start or after white space, outside a quoted scalar. `quote` is the
 * quote a scalar opened on an earlier line and left open ("" for none); the quote still open is returned with the text.
 * A quote counts as opening a scalar only after the line start, white space or one of `{ [ , :`, so the apostrophe in
 * `it's` does not; when unsure the text is kept, which can only add a false positive, never hide a `uses:`.
 */
function stripComment(line, quote) {
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote === '"') {
      if (char === "\\") i++;
      else if (char === '"') quote = "";
    } else if (quote === "'") {
      if (char === "'" && line[i + 1] === "'") i++;
      else if (char === "'") quote = "";
    } else if ((char === '"' || char === "'") && (i === 0 || /[\s{[,:]/.test(line[i - 1]))) {
      quote = char;
    } else if (char === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return { text: line.slice(0, i), quote };
    }
  }
  return { text: line, quote };
}

function check(file) {
  let quote = "";
  // While inside a block scalar: the column of its key; a later line indented further (or blank) is scalar text.
  let blockKeyColumn = -1;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((rawLine, index) => {
      const line = rawLine.replace(/\r$/, "");
      if (blockKeyColumn >= 0) {
        const indent = /^[ \t]*/.exec(line)[0].length;
        if (line.trim() === "" || indent > blockKeyColumn) return;
        blockKeyColumn = -1;
      }
      const stripped = stripComment(line, quote);
      quote = stripped.quote;
      for (const match of stripped.text.matchAll(USES)) {
        const ref = match[1];
        if (ref.startsWith("./")) continue;
        const at = ref.lastIndexOf("@");
        if (at === -1 || !SHA.test(ref.slice(at + 1))) bad.push(`${file}:${index + 1}  ${ref}`);
      }
      if (quote === "") {
        const [, indent, dashes, rest] = BLOCK_SCALAR.exec(stripped.text.trimEnd());
        if (BLOCK_INDICATOR.test(rest)) blockKeyColumn = indent.length + dashes.length;
      }
    });
}

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.ya?ml$/.test(entry.name) ? [path] : [];
  });
}

for (const file of dirs.flatMap(walk)) check(file);

if (bad.length > 0) {
  console.error("Actions must be pinned to a full commit SHA (add the version as a trailing comment):");
  for (const entry of bad) console.error(`  ${entry}`);
  process.exit(1);
}
console.log("ok   every workflow action is pinned to a commit SHA");
