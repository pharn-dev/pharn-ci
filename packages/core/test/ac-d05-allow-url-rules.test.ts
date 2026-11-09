import { describe, expect, it } from "vitest";
import { checkDependencies } from "../src/dependencies/check.js";
import { resolveDependencySettings } from "../src/dependencies/settings.js";
import { parseUnifiedDiff } from "../src/diff/unified.js";
import { dependencyCase } from "./dependencies-helpers.js";
import { fixture } from "./helpers.js";

// d05-private-registry-allowlist, AC-3: allowing a host never relaxes the URL rules. With npm.corp.example allowed, a
// lockfile entry from that host over http, with a user name and token, with a port, or from a host that only ends in
// the allowed name is still a D05 block, while the plain https URL on the allowed host is not. The change is the
// fixtures/dependencies/d05-lockfile case with its head package-lock.json rewritten in memory (left-pad from the URL
// under test, the git entry removed).

const HOST = "npm.corp.example";
const PATH = "/api/npm/npm/left-pad/-/left-pad-1.3.0.tgz";

type Side = { files: Array<{ path: string; text: string }>; dropped: [] };
type Signal = { id: string; severity: string; name?: string; path: string };

function lockfileFrom(text: string, url: string): string {
  const out = text
    .replace("https://packages.example.com/left-pad/-/left-pad-1.3.0.tgz", url)
    .replace(
      '    "node_modules/from-git": {\n      "version": "1.0.0",\n      "resolved": "git+ssh://git@github.com/someone/from-git.git#0123456789abcdef0123456789abcdef01234567"\n    },\n',
      "",
    )
    .replace(',\n      "dependencies": {\n        "from-git": "github:someone/from-git#v1.0.0"\n      }', "");
  if (!out.includes(url) || out.includes("from-git")) throw new Error("the fixture lockfile changed shape");
  return out;
}

/** Every finding (an object with an id and a severity) anywhere in the result. */
function signalsIn(value: unknown, found: Signal[] = []): Signal[] {
  if (Array.isArray(value)) {
    for (const item of value) signalsIn(item, found);
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.id === "string" && typeof record.severity === "string") found.push(record as unknown as Signal);
    else for (const child of Object.values(record)) signalsIn(child, found);
  }
  return found;
}

function d05For(url: string): Signal[] {
  const input = dependencyCase("d05-lockfile");
  const sources = input.dependencySources as { base: Side; head: Side };
  const head = {
    files: sources.head.files.map((f) =>
      f.path === "package-lock.json" ? { path: f.path, text: lockfileFrom(f.text, url) } : f,
    ),
    dropped: [] as [],
  };
  const settings = resolveDependencySettings({ allowedHosts: [HOST] } as never);
  const result = checkDependencies({
    diff: parseUnifiedDiff(fixture("dependencies/d05-lockfile/change.diff")),
    sources: { base: sources.base, head } as never,
    repoFiles: input.repoFiles,
    settings,
  });
  return signalsIn(result).filter((s) => s.id === "D05");
}

describe("allowed hosts keep the URL rules", () => {
  it("AC-3: http, user info, a port or a longer host name on the allowed host is a D05 block; plain https on it is not", () => {
    for (const url of [
      `http://${HOST}${PATH}`,
      `https://user:token@${HOST}${PATH}`,
      `https://${HOST}:8443${PATH}`,
      `https://evil.${HOST}${PATH}`,
    ]) {
      const d05 = d05For(url);
      expect(
        d05.map((s) => [s.severity, s.path, s.name]),
        url,
      ).toEqual([["block", "package-lock.json", "left-pad"]]);
    }
    expect(d05For(`https://${HOST}${PATH}`), "the allowed host itself").toEqual([]);
  });
});
