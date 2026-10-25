import ts from "typescript5";

/**
 * The assertion chain a maximal property-access or call node spells, or `null`. The chain is written with `.name` per
 * property access and `()` per call. The roots, tried in order:
 *
 * 1. `expect` or `expect.<m>`: a call, then at least one more link (`expect(x).toBe(y)`, `expect.soft(x).toBe(y)`).
 * 2. `.should`: written from the leftmost `should`, with at least one link after it (`x.should.equal(1)`).
 * 3. `assert`, with a call somewhere (`assert(ok)`, `assert.strictEqual(a, b)`).
 * 4. `<id>.assert.<m>`, with a call somewhere (`t.assert.ok(x)`).
 *
 * The descent runs through property accesses and calls only; an element access, a non-null assertion or a parenthesis
 * ends it. `expect(x)` alone, `expect.extend({…})`, `expect.assertions(n)` and `expect.objectContaining({…})` are not
 * assertions.
 */
export function assertionChain(node: ts.Node): string | null {
  const links: string[] = [];
  let current: ts.Node = node;
  for (;;) {
    if (ts.isPropertyAccessExpression(current)) {
      links.push(`.${current.name.text}`);
      current = current.expression;
    } else if (ts.isCallExpression(current)) {
      links.push("()");
      current = current.expression;
    } else {
      break;
    }
  }
  links.reverse();
  const root = ts.isIdentifier(current) ? current.text : null;

  if (root === "expect") {
    const callAt = links[0] === "()" ? 0 : links[0] !== undefined && links[1] === "()" ? 1 : -1;
    if (callAt !== -1 && links.length > callAt + 1) return `expect${links.join("")}`;
  }

  const should = links.indexOf(".should");
  if (should !== -1 && links.length > should + 1) return links.slice(should).join("").slice(1);

  if (root === "assert" && links.includes("()")) return `assert${links.join("")}`;

  if (root !== null && links[0] === ".assert" && links.length > 1 && links.includes("()")) {
    return `${root}${links.join("")}`;
  }
  return null;
}

/** `expect.assertions(n)` or `expect.hasAssertions()`, or `null`. Neither is an assertion. */
export function guardCall(
  call: ts.CallExpression,
): { kind: "assertions" | "hasAssertions"; count: number | null } | null {
  const callee = call.expression;
  if (
    !ts.isPropertyAccessExpression(callee) ||
    !ts.isIdentifier(callee.expression) ||
    callee.expression.text !== "expect"
  ) {
    return null;
  }
  if (callee.name.text === "hasAssertions") return { kind: "hasAssertions", count: null };
  if (callee.name.text !== "assertions") return null;
  const argument = call.arguments[0];
  if (argument === undefined || !ts.isNumericLiteral(argument)) return { kind: "assertions", count: null };
  const count = Number(argument.text);
  return { kind: "assertions", count: Number.isFinite(count) ? count : null };
}
