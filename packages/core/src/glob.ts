/**
 * A small, regex-free glob matcher for `coverage.exclude`, `--exclude` and the Action's `exclude` input.
 *
 * The subset:
 * - `/` separates segments; the pattern and the path are both split on it, and nothing else is a separator.
 * - A pattern segment that is exactly `**` is a globstar: it matches zero or more whole path segments.
 * - Inside any other segment, `*` matches any run of code points (possibly none) and `?` matches exactly one
 *   code point. Neither crosses a `/`. Consecutive `*` collapse, so `a**b` behaves like `a*b`.
 * - Every other character is a literal, so `a+(b)|$.ts` matches only itself.
 * - Patterns are anchored at the repository root and must match the whole path. Matching is case-sensitive,
 *   there is no dotfile rule, and the path is matched exactly as given (no normalization).
 *
 * Validation of what a user may write is `parseExcludePattern` in `config.ts`; this module never throws.
 *
 * Cost: both levels are set-of-states simulations with no backtracking, so a match is
 * O(pattern length x path length): linear in the path for a given pattern.
 */

type Token = { readonly kind: "lit"; readonly cp: string } | { readonly kind: "any" } | { readonly kind: "star" };

type SegmentMatcher = (cps: readonly string[], text: string) => boolean;

interface CompiledSegment {
  readonly globstar: boolean;
  readonly matches: SegmentMatcher;
}

/** Compile a glob pattern once; the returned predicate tests repo-relative paths with forward slashes. */
export function compileGlob(pattern: string): (path: string) => boolean {
  const segments = pattern.split("/").map(compileSegment);
  const end = segments.length;
  let active = new Uint8Array(end + 1);
  let next = new Uint8Array(end + 1);

  const closure = (set: Uint8Array): void => {
    for (let i = 0; i < end; i++) {
      if (set[i] === 1 && (segments[i] as CompiledSegment).globstar) set[i + 1] = 1;
    }
  };

  return (path: string): boolean => {
    active.fill(0);
    active[0] = 1;
    closure(active);
    for (const text of path.split("/")) {
      const cps = Array.from(text);
      next.fill(0);
      for (let i = 0; i < end; i++) {
        if (active[i] !== 1) continue;
        const segment = segments[i] as CompiledSegment;
        if (segment.globstar) next[i] = 1;
        else if (segment.matches(cps, text)) next[i + 1] = 1;
      }
      closure(next);
      const swap = active;
      active = next;
      next = swap;
    }
    return active[end] === 1;
  };
}

/** Whether `path` matches `pattern`; `compileGlob(pattern)(path)`. */
export function matchGlob(pattern: string, path: string): boolean {
  return compileGlob(pattern)(path);
}

function compileSegment(segment: string): CompiledSegment {
  if (segment === "**") return { globstar: true, matches: () => false };

  const tokens: Token[] = [];
  for (const cp of segment) {
    if (cp === "*") {
      if (tokens[tokens.length - 1]?.kind !== "star") tokens.push({ kind: "star" });
    } else if (cp === "?") {
      tokens.push({ kind: "any" });
    } else {
      tokens.push({ kind: "lit", cp });
    }
  }

  // No wildcard: the segment is a plain string and must be equal.
  if (tokens.every((t) => t.kind === "lit")) return { globstar: false, matches: (_cps, text) => text === segment };

  const n = tokens.length;
  let active = new Uint8Array(n + 1);
  let next = new Uint8Array(n + 1);
  const closure = (set: Uint8Array): void => {
    for (let j = 0; j < n; j++) {
      if (set[j] === 1 && (tokens[j] as Token).kind === "star") set[j + 1] = 1;
    }
  };

  return {
    globstar: false,
    matches: (cps) => {
      active.fill(0);
      active[0] = 1;
      closure(active);
      for (const cp of cps) {
        next.fill(0);
        for (let j = 0; j < n; j++) {
          if (active[j] !== 1) continue;
          const token = tokens[j] as Token;
          if (token.kind === "star") next[j] = 1;
          else if (token.kind === "any" || token.cp === cp) next[j + 1] = 1;
        }
        closure(next);
        const swap = active;
        active = next;
        next = swap;
      }
      return active[n] === 1;
    },
  };
}
