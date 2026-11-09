import { resolveDependencySettings, resolveInputs } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";
import { fakeDeps } from "./fake-deps.js";

// d05-private-registry-allowlist, AC-5: an allowed-hosts entry that is not a host name, or a list of more than 50, is
// an input error naming the Action input (or the CLI flag) and saying what a host name is; an empty entry between two
// separators is skipped. The CLI exits 2 and writes no report. resolveInputs() is called the way the adapters call
// it, with the input's label in the error text; main() runs on in-memory deps (fake-deps.ts).

const TEXT = {
  coverageFormat: (v: string) => `bad format ${v}`,
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage-root",
  dependencies: "dependencies",
  noCoverageFile: "no coverage file",
};

const BAD = [
  "https://npm.corp.example",
  "npm.corp.example/path",
  "npm.corp.example:8443",
  "*.corp.example",
  "user@npm.corp.example",
];

type Result = { ok: boolean; errors?: Array<{ input: string; message: string }>; inputs?: { dependencies?: unknown } };

function resolveHosts(hosts: string[], label: string): Result {
  return resolveInputs(
    {},
    { coverageFile: "coverage/lcov.info", dependencyAllowedHosts: hosts } as never,
    { ...TEXT, dependencyAllowedHosts: label } as never,
  ) as unknown as Result;
}

describe("the allowed-hosts input", () => {
  it("AC-5: an entry that is not a host name, or 51 entries, is an input error naming the input or flag and saying what a host name is", () => {
    const many = Array.from({ length: 51 }, (_, i) => `h${i}.corp.example`);
    for (const label of ["dependency-allowed-hosts", "--dependency-allowed-host"]) {
      for (const hosts of [...BAD.map((bad) => ["ok.corp.example", bad]), many]) {
        const name = `${label}: ${hosts.length > 2 ? "51 entries" : hosts[1]}`;
        const result = resolveHosts(hosts, label);
        expect(result.ok, name).toBe(false);
        const first = result.errors?.[0];
        expect(first?.input, name).toBe("dependencyAllowedHosts");
        expect(first?.message, name).toContain(label);
        expect(first?.message, name).toMatch(/host name/i);
      }
    }
  });

  it("AC-5: an empty entry between two hosts is skipped, not an error, and the two hosts are allowed", () => {
    const result = resolveHosts(["a.corp.example", "", "b.corp.example"], "dependency-allowed-hosts");
    expect(result.ok).toBe(true);
    const settings = resolveDependencySettings(result.inputs?.dependencies as never) as { allowedHosts?: string[] };
    expect(settings.allowedHosts).toEqual(["a.corp.example", "b.corp.example"]);
  });

  it("AC-5: the CLI exits 2 on a --dependency-allowed-host that is not a host name, says what a host name is, and writes no report", async () => {
    const { main } = await import("../src/main.js");
    for (const bad of BAD) {
      const deps = fakeDeps({});
      const code = await main(["check", "--dependency-allowed-host", bad], deps);
      expect(code, bad).toBe(2);
      expect(deps.out, bad).toBe("");
      expect(deps.err, bad).toContain("--dependency-allowed-host");
      expect(deps.err, bad).toMatch(/host name/i);
    }
  });
});
