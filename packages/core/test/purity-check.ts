/**
 * The purity checks for packages/core/src, as a function of one source text. Returns one label per failed check; an
 * empty list means the text is pure. Shared by purity.test.ts (every real source) and the AC tests (impure samples).
 */
export function purityViolations(text: string): string[] {
  const violations: string[] = [];

  const imports = [
    ...text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm),
    ...text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g),
    // Side-effect imports: `import "x";`
    ...text.matchAll(/^\s*import\s*["']([^"']+)["']/gm),
  ].map((m) => m[1] as string);
  for (const spec of imports) {
    if (!/^\.\.?\//.test(spec)) violations.push(`import of "${spec}"`);
  }

  const checks: [string, RegExp][] = [
    ["process / require / fetch / globalThis", /\b(process|require|fetch|globalThis)\s*[.(]/],
    // Ways around the checks above: computed imports, string evaluation, indexed globals.
    ["dynamic import of a computed specifier", /\bimport\s*\(\s*[^"'\s)]/],
    ["eval / new Function", /\beval\s*\(|\bnew\s+Function\b/],
    ["globalThis[...]", /\bglobalThis\s*\[/],
    // Clocks and non-determinism.
    ["Date", /\bnew\s+Date\b|\bDate\s*[.(]/],
    ["Math.random", /\bMath\s*\.\s*random\b/],
    ["Intl", /\bIntl\s*\./],
    ["performance", /\bperformance\s*\./],
    ["crypto", /\bcrypto\s*\./],
    ["setTimeout / setInterval", /\bset(?:Timeout|Interval)\s*\(/],
    ["Function(", /\bFunction\s*\(/],
  ];
  for (const [label, pattern] of checks) {
    if (pattern.test(text)) violations.push(label);
  }

  return violations;
}
