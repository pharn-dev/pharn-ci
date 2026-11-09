import { describe, expect, it } from "vitest";
import type { CheckInput } from "../src/check.js";
import { dependencyCase, run } from "./dependencies-helpers.js";

// d05-private-registry-allowlist, AC-2: with no allowed-hosts setting, a lockfile entry resolved from a private
// registry host is reported exactly as pharn-ci 0.9.1 reports it. The change is the fixtures/dependencies/d05-lockfile
// case with its head package-lock.json rewritten in memory (left-pad from https://npm.corp.example/..., the git entry
// removed). The pinned signal and message are the 0.9.1 output for that change; the same change with the host allowed
// shows that the missing setting is what keeps the finding.

const HOST = "npm.corp.example";
const PRIVATE_URL = `https://${HOST}/api/npm/npm/left-pad/-/left-pad-1.3.0.tgz`;

type Side = { files: Array<{ path: string; text: string }>; dropped: [] };

function privateLockfile(text: string): string {
  const out = text
    .replace("https://packages.example.com/left-pad/-/left-pad-1.3.0.tgz", PRIVATE_URL)
    .replace(
      '    "node_modules/from-git": {\n      "version": "1.0.0",\n      "resolved": "git+ssh://git@github.com/someone/from-git.git#0123456789abcdef0123456789abcdef01234567"\n    },\n',
      "",
    )
    .replace(',\n      "dependencies": {\n        "from-git": "github:someone/from-git#v1.0.0"\n      }', "");
  if (!out.includes(PRIVATE_URL) || out.includes("from-git")) throw new Error("the fixture lockfile changed shape");
  return out;
}

function privateHostCase(extra: Partial<CheckInput> = {}): { input: CheckInput; line: number } {
  const input = dependencyCase("d05-lockfile", extra);
  const sources = input.dependencySources as { base: Side; head: Side };
  const files = sources.head.files.map((f) =>
    f.path === "package-lock.json" ? { path: f.path, text: privateLockfile(f.text) } : f,
  );
  const lock = files.find((f) => f.path === "package-lock.json")?.text ?? "";
  const line = lock.split("\n").findIndex((l) => l.includes('"node_modules/left-pad"')) + 1;
  return { input: { ...input, dependencySources: { base: sources.base, head: { files, dropped: [] } } }, line };
}

describe("no allowed-hosts setting", () => {
  it("AC-2: the private-host lockfile entry is a D05 block with a DEPENDENCY_D05 error, exactly as 0.9.1 reports it, and only because no host is allowed", () => {
    const { input, line } = privateHostCase();
    expect(line).toBe(21);
    const report = run(input);
    const hint = "Remove the dependency from outside the allowed registries, or use the package's registry release.";
    expect(report.dependencies?.signals).toEqual([
      {
        id: "D05",
        severity: "block",
        ecosystem: "npm",
        name: "left-pad",
        version: "1.3.0",
        path: "package-lock.json",
        line: 21,
        detail: "resolved from a URL outside the allowed registries",
        fix: { kind: "remove-dependency", target: "package-lock.json:21", hint },
      },
    ]);
    expect(report.messages.filter((m) => m.code === "DEPENDENCY_D05")).toEqual([
      {
        level: "error",
        code: "DEPENDENCY_D05",
        text: "1 dependency comes from outside the allowed registries (a git repository, a URL on another host or a local file): `package-lock.json:21`.",
        fix: { kind: "remove-dependency", hint },
      },
    ]);
    expect(report.verdict).toBe("fail");

    const allowed = run(privateHostCase({ dependencySettings: { allowedHosts: [HOST] } as never }).input);
    expect(allowed.dependencies?.signals.filter((s) => s.id === "D05")).toEqual([]);
    expect(allowed.messages.filter((m) => m.code === "DEPENDENCY_D05")).toEqual([]);
  });
});
