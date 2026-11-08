import { describe, expect, it } from "vitest";
import { planDependencyLookups } from "../src/dependencies/check.js";
import type { DependencyLookupResult } from "../src/dependencies/lookup.js";
import {
  packageFacts,
  parseIsoTime,
  type RegistryAnswer,
  registryLookupUrls,
  weeklyDownloads,
} from "../src/dependencies/registry.js";
import { resolveDependencySettings } from "../src/dependencies/settings.js";
import { parseUnifiedDiff } from "../src/diff/unified.js";
import { dependencyCase, run } from "./dependencies-helpers.js";
import { fixture } from "./helpers.js";

// A13 (dependency safety), D01 to D03: the registry answers are recorded fixtures (fixtures/dependencies/registry/), never
// the live network. The Action makes the requests; core plans them and judges the answers.

/** A recorded answer as the Action's client returns it. */
function recorded(name: string): RegistryAnswer {
  const doc = JSON.parse(fixture(`dependencies/registry/${name}.json`)) as { status: number; body: unknown };
  return { kind: "response", status: doc.status, body: JSON.stringify(doc.body) };
}

const HEAD_TIME = parseIsoTime("2026-11-08T00:00:00Z") as number;
const LOOKUP = resolveDependencySettings({ input: "lookup" });

/** The lookup results of the lookups fixture case, from the recordings. */
function lookupResults(): DependencyLookupResult[] {
  const npm = (name: string, pkg: string, downloads: string): DependencyLookupResult => {
    const facts = packageFacts("npm", recorded(pkg));
    return facts.outcome === "found"
      ? { ecosystem: "npm", name, ...facts, weeklyDownloads: weeklyDownloads(recorded(downloads)) }
      : { ecosystem: "npm", name, ...facts };
  };
  const pypi = (name: string, pkg: string): DependencyLookupResult => ({
    ecosystem: "pypi",
    name,
    ...packageFacts("pypi", recorded(pkg)),
  });
  return [
    npm("fresh-thing", "npm-fresh-thing", "npm-downloads-high"),
    npm("left-pad", "npm-left-pad", "npm-downloads-high"),
    npm("reqeusts-helper", "not-found", "npm-downloads-high"),
    npm("tiny-thing", "npm-tiny-thing", "npm-downloads-low"),
    pypi("flask-jwt-securex", "not-found"),
    pypi("fresh-flask", "pypi-fresh-flask"),
    pypi("requests", "pypi-requests"),
  ];
}

describe("registry URLs and answers", () => {
  it("builds the lookup URLs on the three allowed hosts, with the name percent-encoded and normalized for PyPI", () => {
    expect(registryLookupUrls("npm", "left-pad")).toEqual({
      package: "https://registry.npmjs.org/left-pad",
      downloads: "https://api.npmjs.org/downloads/point/last-week/left-pad",
    });
    expect(registryLookupUrls("pypi", "Flask_JWT.Ext")).toEqual({
      package: "https://pypi.org/pypi/flask-jwt-ext/json",
    });
  });

  it("reads the first-publish time, a 404, an oversized answer and the weekly downloads", () => {
    expect(packageFacts("npm", recorded("npm-left-pad"))).toEqual({
      outcome: "found",
      firstPublished: parseIsoTime("2014-03-19T00:28:13.474Z"),
    });
    expect(packageFacts("pypi", recorded("pypi-requests"))).toEqual({
      outcome: "found",
      firstPublished: parseIsoTime("2011-02-14T21:25:39Z"),
    });
    expect(packageFacts("npm", recorded("not-found"))).toEqual({ outcome: "not-found" });
    expect(packageFacts("npm", { kind: "response", status: 200, tooLarge: true })).toEqual({
      outcome: "found",
      firstPublished: null,
    });
    for (const answer of [
      { kind: "timeout" },
      { kind: "network" },
      { kind: "response", status: 500 },
      { kind: "response", status: 429 },
      { kind: "response", status: 200, body: "<html>" },
    ] as RegistryAnswer[]) {
      expect(packageFacts("npm", answer)).toEqual({ outcome: "unavailable" });
    }
    expect(weeklyDownloads(recorded("npm-downloads-low"))).toBe(12);
    expect(weeklyDownloads({ kind: "response", status: 404 })).toBeNull();
    expect(weeklyDownloads({ kind: "response", status: 200, body: '{"downloads":-1}' })).toBe("unavailable");
  });

  it("parses ISO 8601 times by hand", () => {
    expect(parseIsoTime("1970-01-01T00:00:00Z")).toBe(0);
    expect(parseIsoTime("2000-03-01T00:00:00.999Z")).toBe(951868800000);
    expect(parseIsoTime("2024-02-29T12:00:00+02:00")).toBe(1709200800000);
    expect(parseIsoTime("2011-02-14T21:25:39")).toBe(1297718739000);
    for (const bad of ["", "2024-13-01T00:00:00Z", "yesterday", `2024-01-01T00:00:00${"0".repeat(40)}Z`]) {
      expect(parseIsoTime(bad), bad).toBeNull();
    }
  });
});

describe("lookups through check()", () => {
  it("plans each added registry package once, never a scoped npm name, in ecosystem and name order", () => {
    const input = dependencyCase("lookups");
    const diff = parseUnifiedDiff(fixture("dependencies/lookups/change.diff"));
    const plan = planDependencyLookups(diff, input.dependencySources as never, input.repoFiles, LOOKUP);
    expect(plan).toEqual({
      planned: [
        { ecosystem: "npm", name: "fresh-thing" },
        { ecosystem: "npm", name: "left-pad" },
        { ecosystem: "npm", name: "reqeusts-helper" },
        { ecosystem: "npm", name: "tiny-thing" },
        { ecosystem: "pypi", name: "flask-jwt-securex" },
        { ecosystem: "pypi", name: "fresh-flask" },
        { ecosystem: "pypi", name: "requests" },
      ],
      overCap: 0,
    });
    const npmOnly = resolveDependencySettings({ input: "lookup", policy: { kind: "app", registries: ["npm"] } });
    expect(
      planDependencyLookups(diff, input.dependencySources as never, input.repoFiles, npmOnly)?.planned.map(
        (p) => p.name,
      ),
    ).toEqual(["fresh-thing", "left-pad", "reqeusts-helper", "tiny-thing"]);
    expect(
      planDependencyLookups(diff, input.dependencySources as never, input.repoFiles, resolveDependencySettings()),
    ).toEqual({
      planned: [],
      overCap: 0,
    });
  });

  it("D01 for a package the registry does not know, D02 for a young one, D03 for an obscure npm one", () => {
    const report = run(
      dependencyCase("lookups", {
        dependencySettings: { input: "lookup" },
        dependencyLookups: { headTime: HEAD_TIME, results: lookupResults() },
      }),
    );
    expect(report.dependencies?.lookups).toBe("done");
    expect(
      report.dependencies?.signals.map((s) => [s.id, s.severity, s.ecosystem, s.path, s.line, s.name, s.detail]),
    ).toEqual([
      ["D01", "block", "npm", "package.json", 9, "reqeusts-helper", "not found in the registry"],
      ["D01", "block", "pypi", "requirements.txt", 4, "flask-jwt-securex", "not found in the registry"],
      [
        "D02",
        "warn",
        "npm",
        "package.json",
        7,
        "fresh-thing",
        "first published 5 days before the head commit (minimum 30)",
      ],
      [
        "D02",
        "warn",
        "pypi",
        "requirements.txt",
        3,
        "fresh-flask",
        "first published 2 days before the head commit (minimum 30)",
      ],
      ["D03", "warn", "npm", "package.json", 10, "tiny-thing", "12 downloads last week (minimum 100)"],
    ]);
    expect(report.messages.filter((m) => m.code.startsWith("DEPENDENCY_")).map((m) => [m.level, m.code])).toEqual([
      ["error", "DEPENDENCY_D01"],
      ["warn", "DEPENDENCY_D02"],
      ["warn", "DEPENDENCY_D03"],
    ]);
    expect(report.verdict).toBe("fail");
  });

  it("raised minimums from the config only tighten; lookups are off in mode auto and without results", () => {
    const raised = run(
      dependencyCase("lookups", {
        dependencySettings: { input: "lookup", config: { minAgeDays: 3650, minWeeklyDownloads: 5_000_000 } },
        dependencyLookups: { headTime: HEAD_TIME, results: lookupResults() },
      }),
    );
    // left-pad (2014) and requests (2011) are older than ten years; tiny-thing (2019) is not.
    expect(raised.dependencies?.signals.filter((s) => s.id === "D02").map((s) => s.name)).toEqual([
      "fresh-thing",
      "tiny-thing",
      "fresh-flask",
    ]);
    expect(raised.dependencies?.signals.filter((s) => s.id === "D03").map((s) => s.name)).toEqual([
      "fresh-thing",
      "left-pad",
      "tiny-thing",
    ]);
    const auto = run(
      dependencyCase("lookups", { dependencyLookups: { headTime: HEAD_TIME, results: lookupResults() } }),
    );
    expect(auto.dependencies?.lookups).toBe("off");
    expect(auto.dependencies?.signals).toEqual([]);
    const cli = run(dependencyCase("lookups", { dependencySettings: { input: "lookup" } }));
    expect(cli.dependencies?.lookups).toBe("off");
  });

  it("fails open: a missing or unavailable answer adds one DEPENDENCY_LOOKUP_UNAVAILABLE warning", () => {
    const results = lookupResults().filter((r) => r.name !== "requests" && r.name !== "left-pad");
    results.push({ ecosystem: "npm", name: "left-pad", outcome: "unavailable" });
    const report = run(
      dependencyCase("lookups", {
        dependencySettings: { input: "lookup" },
        dependencyLookups: { headTime: null, results },
      }),
    );
    expect(report.dependencies?.lookups).toBe("unavailable");
    expect(report.dependencies?.signals.map((s) => s.id)).toEqual(["D01", "D01", "D03"]);
    expect(report.messages.find((m) => m.code === "DEPENDENCY_LOOKUP_UNAVAILABLE")).toEqual({
      level: "warn",
      code: "DEPENDENCY_LOOKUP_UNAVAILABLE",
      text: "Registry lookups did not complete for 2 of 7 added packages, so D01 to D03 were not checked for them: 2 got no usable answer from the registry (a timeout, a network error or an error status).",
    });
  });

  it("looks up at most 50 packages and counts the rest", () => {
    const names = Array.from({ length: 53 }, (_, i) => `pkg-${String(i).padStart(2, "0")}`);
    const head = `{\n  "dependencies": {\n${names.map((n) => `    "${n}": "^1.0.0"`).join(",\n")}\n  }\n}\n`;
    const input = dependencyCase("d05-manifest", {
      dependencySettings: { input: "lookup" },
      dependencySources: {
        base: { files: [{ path: "package.json", text: "{}" }], dropped: [] },
        head: { files: [{ path: "package.json", text: head }], dropped: [] },
      },
    });
    const diff = parseUnifiedDiff(fixture("dependencies/d05-manifest/change.diff"));
    const plan = planDependencyLookups(diff, input.dependencySources as never, input.repoFiles, LOOKUP);
    expect(plan?.planned).toHaveLength(50);
    expect(plan?.overCap).toBe(3);
    const results = (plan?.planned ?? []).map(
      (p): DependencyLookupResult => ({ ...p, outcome: "found", firstPublished: 0, weeklyDownloads: 1000 }),
    );
    const report = run({ ...input, dependencyLookups: { headTime: HEAD_TIME, results } });
    expect(report.messages.find((m) => m.code === "DEPENDENCY_LOOKUP_UNAVAILABLE")?.text).toBe(
      "Registry lookups did not complete for 3 of 53 added packages, so D01 to D03 were not checked for them: 3 were over the limit of 50 lookups per run.",
    );
  });
});
