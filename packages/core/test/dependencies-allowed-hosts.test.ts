import { describe, expect, it } from "vitest";
import { dependencyCase, run } from "./dependencies-helpers.js";

// Private registry allow-list (D05) through check(): the fixtures/dependencies/d05-private-host case adds, on the host
// npm.corp.example, a package.json URL dependency, two package-lock.json entries and a requirements index option, and,
// off every registry, a git dependency that no allowed host may excuse.

const HOST = "npm.corp.example";

type Signals = Array<[string, string, number | null, string | undefined]>;

function d05(settings?: Record<string, unknown>): Signals {
  const report = run(
    dependencyCase("d05-private-host", settings === undefined ? {} : { dependencySettings: settings }),
  );
  return (report.dependencies?.signals ?? [])
    .filter((signal) => signal.id === "D05")
    .map((signal) => [signal.severity, signal.path, signal.line, signal.name]);
}

describe("D05 with allowed registry hosts", () => {
  it("flags the private host's URLs, entries and index option when no host is allowed", () => {
    expect(d05()).toEqual([
      ["block", "package-lock.json", 22, "corp-url"],
      ["block", "package-lock.json", 26, "corp-utils"],
      ["block", "package-lock.json", 30, "from-git"],
      ["block", "package.json", 6, "corp-url"],
      ["block", "package.json", 8, "from-git"],
      ["block", "requirements.txt", 1, undefined],
    ]);
  });

  it("accepts the allowed host everywhere and still flags the git source", () => {
    expect(d05({ allowedHosts: [HOST] })).toEqual([
      ["block", "package-lock.json", 30, "from-git"],
      ["block", "package.json", 8, "from-git"],
    ]);
  });

  it("matches the host by its whole name, case-insensitively", () => {
    expect(d05({ allowedHosts: ["NPM.Corp.Example"] })).toEqual(d05({ allowedHosts: [HOST] }));
    for (const other of ["corp.example", "evil.npm.corp.example", "npm.corp.example.evil.example"]) {
      expect(d05({ allowedHosts: [other] }), other).toEqual(d05());
    }
  });

  it("names no host in the report, with or without the allow-list", () => {
    for (const settings of [undefined, { allowedHosts: [HOST] }]) {
      const report = run(
        dependencyCase("d05-private-host", settings === undefined ? {} : { dependencySettings: settings }),
      );
      expect(JSON.stringify(report)).not.toContain(HOST);
    }
  });

  it("does not let an allowed host excuse a git source in the same change", () => {
    const report = run(dependencyCase("d05-private-host", { dependencySettings: { allowedHosts: [HOST] } }));
    expect(report.verdict).toBe("fail");
    expect(report.messages.filter((message) => message.code === "DEPENDENCY_D05")).toHaveLength(1);
  });
});
