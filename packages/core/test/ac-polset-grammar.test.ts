import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// E3 item 23 (policy settings), AC-4. covers(), normalizePolicyRule() and parsePermissionRule() are loaded inside the
// test body, and fixtures/policy-settings/grammar.json is read there too: the AC test is written before the build
// adds them. The 50 binding rows are also held here, and the fixture must equal them, so the build cannot satisfy the
// test by editing the fixture.

type Expect = boolean | "unknown";
interface Row {
  row: number;
  a: string;
  f: string;
  p02: Expect;
  p03: Expect;
  also?: string[];
  inert?: true;
  policyRejected?: true;
}
interface Grammar {
  covers(a: string, f: string, reading: "p02" | "p03"): boolean;
  normalizePolicyRule(text: string): { kind: string; text?: string };
  parsePermissionRule(text: string, side: "allow" | "deny"): { kind: string };
}

const T = true;
const F = false;
const U = "unknown" as const;

const ROWS: Row[] = [
  { row: 1, a: "Bash", f: "Bash(rm -rf:*)", p02: T, p03: T },
  { row: 2, a: "Bash(rm:*)", f: "Bash(rm -rf:*)", p02: T, p03: T },
  { row: 3, a: "Bash(rm *)", f: "Bash(rm -rf *)", p02: T, p03: T },
  { row: 4, a: "Bash(rm -rf:*)", f: "Bash(rm -rf *)", p02: T, p03: T },
  { row: 5, a: "Bash(rm -rf /)", f: "Bash(rm -rf:*)", p02: F, p03: F },
  { row: 6, a: "Bash(rm -rf:*)", f: "Bash(rm:*)", p02: F, p03: F },
  { row: 7, a: "Bash(ls *)", f: "Bash(lsof)", p02: F, p03: F },
  { row: 8, a: "Bash(ls*)", f: "Bash(lsof)", p02: T, p03: T },
  { row: 9, a: "Bash(*)", f: "Bash(curl:*)", p02: T, p03: T },
  { row: 10, a: "Bash(git * main)", f: "Bash(git push origin main)", p02: T, p03: T },
  { row: 11, a: "Bash(git push *)", f: "Bash(git * main)", p02: F, p03: F },
  { row: 12, a: "Bash(curl:*)", f: "Bash(curl)", p02: T, p03: T },
  { row: 13, a: "Bash(a:*b)", f: "Bash(ls)", p02: U, p03: U },
  { row: 14, a: "Edit", f: "Edit(//etc/**)", p02: T, p03: T },
  { row: 15, a: "Write", f: "Edit(//etc/**)", p02: T, p03: F },
  { row: 16, a: "Write(//etc/**)", f: "Edit(//etc/**)", p02: F, p03: F, inert: true },
  { row: 17, a: "Edit(/etc/**)", f: "Write(/etc/**)", p02: T, p03: T },
  { row: 18, a: "Edit(//**)", f: "Edit(~/.ssh/**)", p02: T, p03: T },
  { row: 19, a: "Edit(**)", f: "Edit(//etc/**)", p02: F, p03: F },
  { row: 20, a: "Read(.env)", f: "Read(**/.env)", p02: T, p03: T },
  { row: 21, a: "Read(**/.env)", f: "Read(.env)", p02: T, p03: T },
  { row: 22, a: "Read(./.env)", f: "Read(.env)", p02: F, p03: F },
  { row: 23, a: "Read(.env)", f: "Read(./.env)", p02: T, p03: T },
  { row: 24, a: "Read(/.env)", f: "Read(./.env)", p02: T, p03: T },
  { row: 25, a: "Read(src/**)", f: "Read(src/a/b.ts)", p02: T, p03: T },
  { row: 26, a: "Read(src/*)", f: "Read(src/a/b.ts)", p02: F, p03: F },
  { row: 27, a: "Read(src)", f: "Read(src/a.ts)", p02: T, p03: F },
  { row: 28, a: "Read(secrets/)", f: "Read(secrets/key.pem)", p02: T, p03: T },
  { row: 29, a: "Read(**/*.env)", f: "Read(.env)", p02: T, p03: T },
  { row: 30, a: "Read(*.pem)", f: "Read(certs/k.pem)", p02: T, p03: T },
  { row: 31, a: "Read(~/.aws/**)", f: "Read(~/.aws/credentials)", p02: T, p03: T },
  { row: 32, a: "Edit(*)", f: "Edit(src/a.ts)", p02: T, p03: T },
  { row: 33, a: "Edit(*)", f: "Edit(//tmp/x)", p02: F, p03: F },
  { row: 34, a: "Read([ab].env)", f: "Read(x)", p02: U, p03: U, also: ["Read(../x)"] },
  { row: 35, a: "Glob(**)", f: "Read(**)", p02: F, p03: F, inert: true },
  { row: 36, a: "WebFetch", f: "WebFetch(domain:evil.com)", p02: T, p03: T },
  { row: 37, a: "WebFetch(domain:Evil.COM)", f: "WebFetch(domain:evil.com)", p02: T, p03: T },
  { row: 38, a: "WebFetch(domain:*.evil.com)", f: "WebFetch(domain:a.evil.com)", p02: T, p03: F },
  { row: 39, a: "WebFetch(https://x)", f: "WebFetch(domain:x.com)", p02: U, p03: U },
  { row: 40, a: "mcp__github", f: "mcp__github__delete_repo", p02: T, p03: T },
  { row: 41, a: "mcp__github__*", f: "mcp__github__delete_repo", p02: T, p03: T },
  { row: 42, a: "mcp__github__create_issue", f: "mcp__github", p02: F, p03: F },
  { row: 43, a: "mcp__git", f: "mcp__github__x", p02: F, p03: F },
  { row: 44, a: "Agent", f: "Agent(Explore)", p02: T, p03: T },
  { row: 45, a: "Agent(Plan)", f: "Agent(Explore)", p02: F, p03: F },
  { row: 46, a: "Agent(*)", f: "Agent(Explore)", p02: T, p03: F },
  { row: 47, a: "bash", f: "Bash", p02: F, p03: F },
  { row: 48, a: " Bash", f: "Bash(curl:*)", p02: T, p03: U },
  { row: 49, a: "Edit([ab])", f: "Edit([ab])", p02: T, p03: T, policyRejected: true },
  { row: 50, a: "Edit(**)", f: "Edit([ab])", p02: F, p03: F },
];

const SIDE = { p02: "allow", p03: "deny" } as const;

describe("the permission-rule grammar", () => {
  it("AC-4: every row of fixtures/policy-settings/grammar.json gives its p02 and p03 result, and the unknown-syntax rows are reported as unknown syntax", async () => {
    expect(ROWS).toHaveLength(50);
    expect(ROWS.map((r) => r.row)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(JSON.parse(fixture("policy-settings/grammar.json")), "the fixture holds exactly the binding rows").toEqual(
      ROWS,
    );

    const g = (await import("@pharn-ci/core")) as unknown as Grammar;
    for (const name of ["covers", "normalizePolicyRule", "parsePermissionRule"] as const) {
      expect(typeof g[name], `${name} is exported`).toBe("function");
    }

    for (const row of ROWS) {
      for (const a of [row.a, ...(row.also ?? [])]) {
        for (const reading of ["p02", "p03"] as const) {
          const want = row[reading];
          const label = `row ${row.row}: covers(${JSON.stringify(a)}, ${JSON.stringify(row.f)}, ${reading})`;
          expect(g.covers(a, row.f, reading), label).toBe(want === true);
          const parsed = g.parsePermissionRule(a, SIDE[reading]).kind;
          if (want === "unknown")
            expect(parsed, `${label}: unknown syntax on the ${SIDE[reading]} side`).toBe("unknown");
          else if (row.inert) expect(parsed, `${label}: inert`).toBe("inert");
          else if (row.row === 49) expect(parsed, `${label}: a settings entry the grammar rejects`).toBe("unknown");
          else expect(parsed, `${label}: a parsed rule`).toBe("rule");
        }
      }
      // `Edit([ab])` (rows 49 and 50) is a policy entry the grammar rejects; row 49 says so in the fixture.
      if (row.policyRejected || row.f === "Edit([ab])") {
        expect(g.normalizePolicyRule(row.f), `row ${row.row}: the policy entry is rejected`).toEqual({
          kind: "rejected",
          text: row.f,
        });
      } else {
        expect(g.normalizePolicyRule(row.f).kind, `row ${row.row}: the policy entry parses`).toBe("rule");
      }
    }
  });
});
