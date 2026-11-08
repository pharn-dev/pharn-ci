/**
 * The CODEOWNERS comparison of rule P13. Conservative: the only change that is not a loosening is adding owners to a
 * rule line whose pattern and place stay as they were; blank lines and comments are ignored. Any other change (a rule
 * added, removed, moved or re-patterned, an owner removed) can hand a path to fewer or other owners, since the last
 * matching line wins. A deleted CODEOWNERS counts, and so does an added one: GitHub reads only the first CODEOWNERS it
 * finds (`.github/`, the root, `docs/`), so a new file can replace the one in force. Nothing here returns file text.
 */

/** The fixed words of a CODEOWNERS loosening. */
export const CODEOWNERS_WIDENINGS = ["file added", "rules changed", "file deleted"] as const;
export type CodeownersWidening = (typeof CODEOWNERS_WIDENINGS)[number];

interface Rule {
  pattern: string;
  owners: Set<string>;
}

/** The rule lines of a CODEOWNERS text: comments (`#` not escaped) and blank lines dropped. */
function rulesOf(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const line of text.split(/\r\n|\n|\r/)) {
    const bare = line.replace(/(^|[^\\])#.*$/, "$1").trim();
    if (bare === "") continue;
    const tokens = bare.split(/(?<!\\)\s+/);
    rules.push({
      pattern: tokens[0] as string,
      owners: new Set(tokens.slice(1).map((owner) => owner.toLowerCase())),
    });
  }
  return rules;
}

/** The loosenings of a CODEOWNERS file from base to head; null text is a file absent on that side. */
export function codeownersWidenings(base: string | null, head: string | null): CodeownersWidening[] {
  if (base === null && head === null) return [];
  if (base === null) return ["file added"];
  if (head === null) return ["file deleted"];
  const before = rulesOf(base);
  const after = rulesOf(head);
  if (before.length !== after.length) return ["rules changed"];
  for (let i = 0; i < before.length; i++) {
    const b = before[i] as Rule;
    const a = after[i] as Rule;
    if (a.pattern !== b.pattern) return ["rules changed"];
    for (const owner of b.owners) if (!a.owners.has(owner)) return ["rules changed"];
  }
  return [];
}
