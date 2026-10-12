// Fails unless CHANGELOG.md is ready to be released as version X.Y.Z: exactly one heading for the
// version, `## [X.Y.Z] - YYYY-MM-DD` with a real date, and release notes under it that still carry
// neither the `YYYY-MM-DD` placeholder nor the maintainer's instruction sentence. Run by the
// `Release verify` job of .github/workflows/release.yml, before anything is installed, so it uses
// Node built-ins only. Run from the repo root:
//   node scripts/check-release-notes.mjs X.Y.Z [CHANGELOG.md]
// The notes are the lines after the heading up to the next `## [` line, as release.yml extracts them.
import { readFileSync } from "node:fs";

const [version, changelogPath = "CHANGELOG.md"] = process.argv.slice(2);
const errors = [];

if (typeof version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
  errors.push(`version "${version ?? ""}" is not X.Y.Z`);
} else {
  const lines = readFileSync(changelogPath, "utf8").split(/\r?\n/);
  const prefix = `## [${version}]`;
  const headings = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.startsWith(prefix));
  const strict = new RegExp(`^## \\[${version.replaceAll(".", "\\.")}\\] - ([0-9]{4})-([0-9]{2})-([0-9]{2})$`);

  if (headings.length === 0) {
    errors.push(`${changelogPath} has no '${prefix} - <date>' section`);
  } else if (headings.length > 1) {
    errors.push(`${changelogPath} has ${headings.length} '${prefix}' headings; keep exactly one`);
  } else {
    const { line, index } = headings[0];
    const match = strict.exec(line);
    if (!match) {
      errors.push(
        `${changelogPath}:${index + 1} heading "${line}" must be exactly '${prefix} - <release date as YYYY-MM-DD>'`,
      );
    } else {
      const [year, month, day] = match.slice(1).map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        errors.push(`${changelogPath}:${index + 1} heading date ${match.slice(1).join("-")} is not a calendar date`);
      }
    }

    const rest = lines.slice(index + 1);
    const end = rest.findIndex((next) => next.startsWith("## ["));
    const notes = (end === -1 ? rest : rest.slice(0, end)).join("\n");
    if (notes.includes("YYYY-MM-DD")) {
      errors.push(`the '${prefix}' release notes still contain the YYYY-MM-DD placeholder`);
    }
    if (/the\s+maintainer\s+replaces/i.test(notes)) {
      errors.push(
        `the '${prefix}' release notes still contain the maintainer instruction ("The maintainer replaces ..."); delete it`,
      );
    }
    if (notes.trim() === "") {
      errors.push(`the '${prefix}' section of ${changelogPath} is empty`);
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.log(`::error::${error}`);
  process.exit(1);
}
console.log(`ok   ${changelogPath} is ready to release ${version}`);
