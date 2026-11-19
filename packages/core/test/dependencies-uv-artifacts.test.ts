import { describe, expect, it } from "vitest";
import type { CheckInput } from "../src/check.js";
import { parsePythonLock } from "../src/dependencies/pythonLock.js";
import { artifactHosts, REGISTRY_FILE_HOSTS } from "../src/dependencies/urls.js";
import type { Report } from "../src/report.js";
import { dependencyCase, REPO_ROOT, run } from "./dependencies-helpers.js";
import { fixture } from "./helpers.js";

// CORE-9 R4.8: uv installs a registry package from the artifact URLs its uv.lock records (`uv sync --frozen` does not
// re-resolve): real uv 0.13.9 sent `GET` to a `wheels[].url` and to an `sdist.url` on 127.0.0.1 for a package whose
// source is `{ registry = "https://pypi.org/simple" }` (recorded in the PR). D05 judged the package by its `source`
// only, so a hand-edited lockfile could keep the PyPI source and point the wheel or sdist URL anywhere. Now each `url`
// of `sdist` and of every `wheels` item, in any TOML spelling, must be https on the package's registry host, on a file
// host of that registry (PyPI: files.pythonhosted.org) or on an allowed host; anything else is D05 for the package.
//
// fixtures/dependencies/uv-artifacts adds one uv.lock per case: PyPI packages with an artifact on evil.example (inline,
// `[package.sdist]` / `[[package.wheels]]` headers and dotted keys), their controls on files.pythonhosted.org, a
// private registry with artifacts on its own host and with a wheel on another host, editable and virtual packages with
// no artifacts, and a `url` source whose wheel is the same URL (one finding, not two).

const URL_OUT = "resolved from a URL outside the allowed registries";
const WHEEL_OUT = "resolved from a wheel URL outside the allowed registries";
const SDIST_OUT = "resolved from an sdist URL outside the allowed registries";
const PRIVATE = "pypi.internal.example.com";

const d05ByPath = (report: Report) =>
  Object.fromEntries(
    (report.dependencies?.signals ?? [])
      .filter((s) => s.id === "D05")
      .map((s) => [s.path, [s.severity, s.line, s.name ?? null, s.detail]]),
  );

const fixtureRun = (allowedHosts?: string[]) =>
  run(dependencyCase("uv-artifacts", allowedHosts === undefined ? {} : { dependencySettings: { allowedHosts } }));

describe("uv.lock sdist and wheel URLs reach D05", () => {
  it("flags an sdist or wheel URL off the registry for a PyPI package, in every spelling", () => {
    const report = fixtureRun();
    expect(d05ByPath(report)).toEqual({
      "private-wheel-elsewhere/uv.lock": ["block", 16, "certifi", URL_OUT],
      "private/uv.lock": ["block", 16, "certifi", URL_OUT],
      "sdist-evil-dotted/uv.lock": ["block", 20, "certifi", SDIST_OUT],
      "sdist-evil-tables/uv.lock": ["block", 22, "certifi", SDIST_OUT],
      "sdist-evil/uv.lock": ["block", 20, "certifi", SDIST_OUT],
      "url-source/uv.lock": ["block", 16, "certifi", URL_OUT],
      "wheel-evil-tables/uv.lock": ["block", 27, "certifi", WHEEL_OUT],
      "wheel-evil/uv.lock": ["block", 22, "certifi", WHEEL_OUT],
    });
    expect(report.dependencies?.signals.every((s) => s.id === "D05")).toBe(true);
    expect(report.dependencies?.unread).toBeUndefined();
    expect(report.verdict).toBe("fail");
    expect(JSON.stringify(report)).not.toContain("evil.example");
  });

  it("passes PyPI artifacts on files.pythonhosted.org and packages with no artifacts", () => {
    const flagged = Object.keys(d05ByPath(fixtureRun()));
    for (const control of [
      "pypi/uv.lock",
      "pypi-tables/uv.lock",
      "pypi-dotted/uv.lock",
      "local/uv.lock",
      "url-source-pypi/uv.lock",
    ]) {
      expect(flagged, control).not.toContain(control);
    }
  });

  it("passes a private registry's artifacts on its allowed host, and flags a wheel on another host", () => {
    const report = fixtureRun([PRIVATE]);
    const d05 = d05ByPath(report);
    expect(d05["private/uv.lock"]).toBeUndefined();
    expect(d05["private-wheel-elsewhere/uv.lock"]).toEqual(["block", 22, "certifi", WHEEL_OUT]);
    expect(Object.keys(d05)).toHaveLength(7);
    expect(JSON.stringify(report)).not.toContain(PRIVATE);
  });

  it("lets an allowed host excuse an artifact on it, as it excuses a source", () => {
    const d05 = d05ByPath(fixtureRun(["evil.example"]));
    expect(Object.keys(d05).sort()).toEqual(["private-wheel-elsewhere/uv.lock", "private/uv.lock"]);
  });

  it("reads the same artifacts from every spelling", () => {
    const head = (dir: string) => parsePythonLock(fixture(`dependencies/uv-artifacts/head/${dir}/uv.lock.txt`), "uv");
    const artifacts = (dir: string) =>
      head(dir)?.entries.map((e) => e.artifacts?.map((a) => [a.kind, a.url, a.allowed]));
    expect(artifacts("pypi-tables")).toEqual(artifacts("pypi"));
    expect(artifacts("pypi-dotted")).toEqual(artifacts("pypi"));
    expect(artifacts("pypi")?.[1]).toEqual([
      ["sdist", "https://files.pythonhosted.org/packages/c2/02/certifi-2024.7.4.tar.gz", true],
      ["wheel", "https://files.pythonhosted.org/packages/1c/d5/certifi-2024.7.4-py3-none-any.whl", true],
    ]);
    expect(artifacts("local")).toEqual([undefined, undefined]);
  });
});

describe("the file hosts of an allowed registry", () => {
  it("maps PyPI to files.pythonhosted.org and no other registry to a second host", () => {
    expect([...REGISTRY_FILE_HOSTS.entries()]).toEqual([["pypi.org", ["files.pythonhosted.org"]]]);
    expect(artifactHosts("https://pypi.org/simple")).toEqual(["pypi.org", "files.pythonhosted.org"]);
    expect(artifactHosts("https://PyPI.org/simple/")).toEqual(["pypi.org", "files.pythonhosted.org"]);
    expect(artifactHosts("https://pypi.internal.example.com/simple")).toEqual(["pypi.internal.example.com"]);
    expect(artifactHosts("https://constructor/simple")).toEqual(["constructor"]);
    expect(artifactHosts("../wheels")).toEqual([]);
  });
});

describe("uv.lock artifacts that are not the shape uv writes", () => {
  const pkg = (rest: string) =>
    `[[package]]\nname = "certifi"\nversion = "2024.7.4"\nsource = { registry = "https://pypi.org/simple" }\n${rest}`;

  it.each([
    'sdist = "https://evil.example/c.tar.gz"\n',
    'sdist = ["https://evil.example/c.tar.gz"]\n',
    "sdist = { url = 1 }\n",
    'wheels = "https://evil.example/c.whl"\n',
    'wheels = { url = "https://evil.example/c.whl" }\n',
    'wheels = ["https://evil.example/c.whl"]\n',
    "wheels = [{ url = true }]\n",
    '[package.sdist]\nurl = ["https://evil.example/c.tar.gz"]\n',
    '[[package.wheels]]\nurl = { href = "https://evil.example/c.whl" }\n',
  ])("leaves the lockfile unread: %s", (rest) => {
    expect(parsePythonLock(pkg(rest), "uv")).toBeNull();
  });

  it("reads artifacts with no url (a path or a file name) as none", () => {
    const parsed = parsePythonLock(
      pkg('sdist = { path = "vendor/c.tar.gz" }\nwheels = [{ filename = "c-py3-none-any.whl", hash = "sha256:aa" }]\n'),
      "uv",
    );
    expect(parsed?.entries[0]?.artifacts).toEqual([]);
  });

  it("does not read sdist or wheels in a poetry.lock, whose files hold names and hashes only", () => {
    const parsed = parsePythonLock(pkg('wheels = "x"\n'), "poetry");
    expect(parsed?.entries[0]?.artifacts).toBeUndefined();
  });
});

// check() on one uv.lock change, added (base null) or modified.
function input(base: string | null, head: string, allowedHosts?: string[]): CheckInput {
  const path = "uv.lock";
  const header =
    base === null
      ? `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+x\n`
      : `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-x\n+x\n`;
  return {
    version: "0.1.0",
    coverage: { missingFile: "coverage/lcov.info" },
    diff: { text: header },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: [path],
    dependencySources: {
      base: { files: base === null ? [] : [{ path, text: base }], dropped: [] },
      head: { files: [{ path, text: head }], dropped: [] },
    },
    ...(allowedHosts === undefined ? {} : { dependencySettings: { allowedHosts } }),
  };
}

const d05 = (base: string | null, head: string, allowedHosts?: string[]) => {
  const report = run(input(base, head, allowedHosts));
  expect(report.dependencies?.unread).toBeUndefined();
  return (report.dependencies?.signals ?? []).filter((s) => s.id === "D05").map((s) => `${s.line} ${s.detail}`);
};

const TOP = 'version = 1\nrevision = 3\nrequires-python = ">=3.11"\n\n';
const lock = (source: string, sdist: string, wheel: string) =>
  `${TOP}[[package]]\nname = "certifi"\nversion = "2024.7.4"\n${source}sdist = { url = "${sdist}", hash = "sha256:aa", size = 1 }\nwheels = [\n    { url = "${wheel}", hash = "sha256:bb", size = 2 },\n]\n`;
const PYPI = 'source = { registry = "https://pypi.org/simple" }\n';
const SDIST = "https://files.pythonhosted.org/packages/certifi-2024.7.4.tar.gz";
const WHEEL = "https://files.pythonhosted.org/packages/certifi-2024.7.4-py3-none-any.whl";

describe("uv.lock artifact URLs through check()", () => {
  it("flags a wheel URL a pull request moves off the registry while the package keeps its source and version", () => {
    expect(d05(lock(PYPI, SDIST, WHEEL), lock(PYPI, SDIST, "https://evil.example/certifi.whl"))).toEqual([
      `11 ${WHEEL_OUT}`,
    ]);
    expect(d05(lock(PYPI, SDIST, WHEEL), lock(PYPI, "https://evil.example/certifi.tar.gz", WHEEL))).toEqual([
      `9 ${SDIST_OUT}`,
    ]);
  });

  it("does not judge again an artifact URL the merge base already had", () => {
    const evil = lock(PYPI, SDIST, "https://evil.example/certifi.whl");
    expect(d05(evil, evil)).toEqual([]);
    expect(d05(lock(PYPI, SDIST, WHEEL), lock(PYPI, SDIST, WHEEL))).toEqual([]);
  });

  it("allows a PyPI package's files on files.pythonhosted.org and pypi.org only, https with no port or user", () => {
    expect(d05(null, lock(PYPI, SDIST, WHEEL))).toEqual([]);
    expect(d05(null, lock(PYPI, SDIST, "https://pypi.org/packages/certifi-2024.7.4-py3-none-any.whl"))).toEqual([]);
    for (const wheel of [
      "https://registry.npmjs.org/certifi/-/certifi-2024.7.4-py3-none-any.whl",
      "http://files.pythonhosted.org/packages/certifi-2024.7.4-py3-none-any.whl",
      "https://files.pythonhosted.org:8443/packages/certifi-2024.7.4-py3-none-any.whl",
      "https://user:token@files.pythonhosted.org/packages/certifi-2024.7.4-py3-none-any.whl",
      "https://files.pythonhosted.org.evil.example/certifi-2024.7.4-py3-none-any.whl",
      "file:///tmp/certifi-2024.7.4-py3-none-any.whl",
    ]) {
      expect(d05(null, lock(PYPI, SDIST, wheel)), wheel).toEqual([`11 ${WHEEL_OUT}`]);
    }
  });

  it("names the first artifact off the registry once, however many there are", () => {
    const head = lock(PYPI, "https://evil.example/c.tar.gz", "https://evil.example/c.whl").replace(
      "},\n]\n",
      '},\n    { url = "https://evil.example/c2.whl", hash = "sha256:cc" },\n]\n',
    );
    expect(d05(null, head)).toEqual([`9 ${SDIST_OUT}`]);
  });

  it("judges a package with no source as a PyPI one", () => {
    expect(d05(null, lock("", SDIST, WHEEL))).toEqual([]);
    expect(d05(null, lock("", SDIST, "https://evil.example/c.whl"))).toEqual([`10 ${WHEEL_OUT}`]);
  });

  it("gives a url source one finding, and judges its other artifacts by the source's host", () => {
    const evil = "https://evil.example/certifi-2024.7.4-py3-none-any.whl";
    expect(d05(null, lock(`source = { url = "${evil}" }\n`, evil, evil))).toEqual([`5 ${URL_OUT}`]);
    expect(d05(null, lock(`source = { url = "${WHEEL}" }\n`, SDIST, WHEEL))).toEqual([]);
    expect(d05(null, lock(`source = { url = "${WHEEL}" }\n`, SDIST, evil))).toEqual([`11 ${WHEEL_OUT}`]);
  });

  it("gives a path source its one local-file finding, artifacts or not", () => {
    const head = `${TOP}[[package]]\nname = "certifi"\nversion = "2024.7.4"\nsource = { path = "vendor/certifi-2024.7.4-py3-none-any.whl" }\nwheels = [\n    { filename = "certifi-2024.7.4-py3-none-any.whl", hash = "sha256:bb" },\n]\n`;
    expect(d05(null, head)).toEqual(["5 resolved from a local file"]);
  });

  it("accepts a private registry's artifacts on another host only when that host is allowed too", () => {
    const priv = 'source = { registry = "https://pypi.internal.example.com/simple" }\n';
    const head = lock(priv, "https://pypi.internal.example.com/c.tar.gz", "https://files.internal.example.com/c.whl");
    expect(d05(null, head)).toEqual([`5 ${URL_OUT}`]);
    expect(d05(null, head, [PRIVATE])).toEqual([`11 ${WHEEL_OUT}`]);
    expect(d05(null, head, [PRIVATE, "files.internal.example.com"])).toEqual([]);
    // An allowed host is not a file host of PyPI: a PyPI package's wheel on it passes only because the host is allowed.
    expect(
      d05(null, lock(PYPI, SDIST, "https://files.internal.example.com/c.whl"), ["files.internal.example.com"]),
    ).toEqual([]);
  });
});
