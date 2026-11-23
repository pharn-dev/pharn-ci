import { describe, expect, it } from "vitest";
import type { PolicyFileBase } from "../src/policy/agents.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { PolicyDocument } from "../src/policy/types.js";
import { uniteFilePolicy } from "../src/policy/unite.js";
import { validatePolicy } from "../src/policy/validate.js";
import { fixture } from "./helpers.js";

// The key table of docs/policy.md ("Changing a `file:` policy"), one assertion per row, over a base copy that sets every
// united key strict and a head copy that loosens, deletes or widens each of them (fixtures/policy-file-base).

function load(name: string): PolicyDocument {
  const checked = validatePolicy(JSON.parse(fixture(`policy-file-base/${name}`)));
  if (!checked.ok) throw new Error(`${name} is not a valid policy: ${JSON.stringify(checked.errors)}`);
  return checked.policy;
}

const BASE = load("base.json");
const HEAD = load("head.json");

const file = (document: PolicyDocument): ResolvedPolicy => ({
  source: "file",
  version: null,
  path: ".pharn/policy.json",
  document,
});
const documentBase = (document: PolicyDocument): PolicyFileBase => ({ kind: "document", document });

describe("uniteFilePolicy over the key table", () => {
  const united = uniteFilePolicy(file(HEAD), documentBase(BASE));
  const document = united.policy.document as PolicyDocument;

  it("keeps the two copies and the path, and replaces only the document", () => {
    expect(united.policy.copies).toEqual({ head: HEAD, base: BASE });
    expect(united.policy.source).toBe("file");
    expect(united.policy.path).toBe(".pharn/policy.json");
    expect(document.version).toBe(1);
  });

  it("takes the higher threshold, and the head's exclude and root alone", () => {
    expect(document.coverage).toEqual({ threshold: 90, exclude: ["tests/**"], root: "packages/head" });
  });

  it("unites setup: true wins, lists are unions (head first), the allowlist is the intersection, the rest strictest", () => {
    expect(document.setup).toEqual({
      require: true,
      expect: ["claude-code", "cursor"],
      consistency: "block",
      forbidden_permissions: ["Bash(curl:*)", "Bash(rm:*)"],
      required_permissions_deny: ["Read(.env)"],
      allowed_mcp_servers: ["docs"],
      forbidden_mcp_servers: ["shell"],
      required_hooks: [
        { event: "PreToolUse", matcher: "Edit" },
        { event: "PreToolUse", matcher: "Bash" },
      ],
      forbidden_files: ["*.pem"],
    });
  });

  it("takes the strictest mode and signals, and the head's accept label alone", () => {
    expect(document.test_integrity).toEqual({
      mode: "block",
      signals: { TI01: "block", TI02: "block" },
      accept_label: "head-label",
    });
  });

  it("switches quarantine off when either copy does, and takes the strictest rules and the head's `required`", () => {
    expect(document.flaky).toEqual({ quarantine: false });
    expect(document.policy).toEqual({ required: false, rules: { P02: "block", P05: "block" } });
  });

  it("unites agents: lists are unions, the mode strictest, the caps the smaller, human approval true", () => {
    expect(document.agents).toEqual({
      labels: ["other", "bot"],
      extra_logins: ["helper[bot]"],
      protected_paths: ["migrations/**", "infra/**"],
      protected_paths_mode: "block",
      require_human_approval: true,
      max_files: 20,
      max_changed_lines: 400,
    });
  });

  it("unites dependencies: lookup true, the higher floors, the head's registries and hosts alone", () => {
    expect(document.dependencies).toEqual({
      lookup: true,
      registries: ["pypi"],
      min_age_days: 60,
      min_weekly_downloads: 500,
      allowed_hosts: ["npm.head.example"],
    });
  });

  it("unites injection: phrases are a union, severities the strictest, exempt the head's alone", () => {
    expect(document.injection).toEqual({
      exempt: ["generated/**"],
      phrases: ["something new", "ignore previous instructions"],
      signals: { PI02: "block", PI03: "block" },
    });
  });

  it("names, as looser, every setting whose head value is looser than the base's, once each and sorted", () => {
    expect(united.ignored.map((record) => record.setting)).toEqual([
      "agents.extra_logins",
      "agents.labels",
      "agents.max_changed_lines",
      "agents.max_files",
      "agents.protected_paths",
      "agents.protected_paths_mode",
      "agents.require_human_approval",
      "coverage.threshold",
      "dependencies.lookup",
      "dependencies.min_age_days",
      "dependencies.min_weekly_downloads",
      "flaky.quarantine",
      "injection.phrases",
      "injection.signals.PI02",
      "injection.signals.PI03",
      "setup.allowed_mcp_servers",
      "setup.consistency",
      "setup.expect",
      "setup.forbidden_files",
      "setup.forbidden_mcp_servers",
      "setup.forbidden_permissions",
      "setup.require",
      "setup.required_hooks",
      "setup.required_permissions_deny",
      "test_integrity.mode",
    ]);
    expect(united.ignored.every((record) => record.reason === "looser")).toBe(true);
  });

  it("leaves the settings compared where the finding is resolved, and the head-only keys, unrecorded", () => {
    const settings = united.ignored.map((record) => record.setting);
    expect(settings.some((setting) => setting.startsWith("test_integrity.signals"))).toBe(false);
    expect(settings.some((setting) => setting.startsWith("policy.rules"))).toBe(false);
    for (const headOnly of [
      "coverage.exclude",
      "coverage.root",
      "test_integrity.accept_label",
      "policy.required",
      "dependencies.registries",
      "dependencies.allowed_hosts",
      "injection.exempt",
    ]) {
      expect(settings).not.toContain(headOnly);
    }
  });
});

describe("uniteFilePolicy, the single rules", () => {
  const unite = (head: PolicyDocument, base: PolicyDocument) => {
    const result = uniteFilePolicy(file(head), documentBase(base));
    return { document: result.policy.document as PolicyDocument, ignored: result.ignored.map((r) => r.setting) };
  };

  it("gives the base's allowlist when the two lists share no server, and records it", () => {
    const result = unite(
      { version: 1, setup: { allowed_mcp_servers: ["mine"] } },
      { version: 1, setup: { allowed_mcp_servers: ["theirs", "also"] } },
    );
    expect(result.document.setup?.allowed_mcp_servers).toEqual(["theirs", "also"]);
    expect(result.ignored).toEqual(["setup.allowed_mcp_servers"]);
  });

  it("takes the base's allowlist when the head deletes or empties it, and the head's when the base has none", () => {
    const heads: PolicyDocument[] = [{ version: 1 }, { version: 1, setup: { allowed_mcp_servers: [] } }];
    for (const head of heads) {
      const result = unite(head, { version: 1, setup: { allowed_mcp_servers: ["docs"] } });
      expect(result.document.setup?.allowed_mcp_servers).toEqual(["docs"]);
      expect(result.ignored).toEqual(["setup.allowed_mcp_servers"]);
    }
    const added = unite({ version: 1, setup: { allowed_mcp_servers: ["docs"] } }, { version: 1 });
    expect(added.document.setup?.allowed_mcp_servers).toEqual(["docs"]);
    expect(added.ignored).toEqual([]);
  });

  it("does not record a narrower head allowlist", () => {
    const result = unite(
      { version: 1, setup: { allowed_mcp_servers: ["docs"] } },
      { version: 1, setup: { allowed_mcp_servers: ["docs", "search"] } },
    );
    expect(result.document.setup?.allowed_mcp_servers).toEqual(["docs"]);
    expect(result.ignored).toEqual([]);
  });

  it("takes the smaller cap and records a head cap that is larger or deleted, not a smaller one", () => {
    const base: PolicyDocument = { version: 1, agents: { max_files: 20, max_changed_lines: 400 } };
    const larger = unite({ version: 1, agents: { max_files: 50 } }, base);
    expect(larger.document.agents).toEqual({ max_files: 20, max_changed_lines: 400 });
    expect(larger.ignored).toEqual(["agents.max_changed_lines", "agents.max_files"]);
    const smaller = unite({ version: 1, agents: { max_files: 5, max_changed_lines: 100 } }, base);
    expect(smaller.document.agents).toEqual({ max_files: 5, max_changed_lines: 100 });
    expect(smaller.ignored).toEqual([]);
  });

  it("applies the base's `require_human_approval` and records its deletion", () => {
    const result = unite({ version: 1 }, { version: 1, agents: { require_human_approval: true } });
    expect(result.document.agents).toEqual({ require_human_approval: true });
    expect(result.ignored).toEqual(["agents.require_human_approval"]);
  });

  it("records a deleted protected_paths_mode only when the base sets block, and keeps the strictest", () => {
    const base: PolicyDocument = { version: 1, agents: { protected_paths_mode: "block" } };
    const heads: PolicyDocument[] = [{ version: 1 }, { version: 1, agents: { protected_paths_mode: "warn" } }];
    for (const head of heads) {
      const result = unite(head, base);
      expect(result.document.agents?.protected_paths_mode).toBe("block");
      expect(result.ignored).toEqual(["agents.protected_paths_mode"]);
    }
    const stricter = unite({ version: 1 }, { version: 1, agents: { protected_paths_mode: "warn" } });
    expect(stricter.ignored).toEqual([]);
  });

  it("compares severities by their effective value: a base at the default that the head deletes is not looser", () => {
    // PI02's default is warn, PI01's block; consistency and mode default to warn.
    const base: PolicyDocument = {
      version: 1,
      setup: { consistency: "warn" },
      test_integrity: { mode: "warn" },
      injection: { signals: { PI01: "block", PI02: "warn" } },
      dependencies: { min_age_days: 30, min_weekly_downloads: 100 },
    };
    const result = unite({ version: 1 }, base);
    expect(result.ignored).toEqual([]);
    // A head below the default is named against the layers and the default elsewhere; against a base at the default
    // its effective value is equal, so uniteFilePolicy records nothing for it. The mode is the exception: a mode the
    // head sets is compared with the base's mode itself, because the inputs can give `off`, below the default.
    const lowered = unite(
      { version: 1, test_integrity: { mode: "off" }, injection: { signals: { PI02: "off" } } },
      base,
    );
    expect(lowered.ignored).toEqual(["test_integrity.mode"]);
  });

  it("records a raised PI severity the head deletes or lowers, and a dependencies floor it lowers", () => {
    const base: PolicyDocument = {
      version: 1,
      injection: { signals: { PI02: "block" } },
      dependencies: { min_age_days: 90 },
    };
    const result = unite({ version: 1, dependencies: { min_age_days: 10 } }, base);
    expect(result.document.injection?.signals).toEqual({ PI02: "block" });
    expect(result.document.dependencies?.min_age_days).toBe(90);
    expect(result.ignored).toEqual(["dependencies.min_age_days", "injection.signals.PI02"]);
  });

  it("takes a head value that is stricter than the base's, with no record", () => {
    const result = unite(
      {
        version: 1,
        coverage: { threshold: 95 },
        test_integrity: { mode: "block", signals: { TI01: "block" } },
        setup: { require: true, consistency: "block" },
        flaky: { quarantine: false },
        dependencies: { min_age_days: 90 },
      },
      {
        version: 1,
        coverage: { threshold: 80 },
        test_integrity: { mode: "warn", signals: { TI01: "warn" } },
        setup: { require: false, consistency: "warn" },
        flaky: { quarantine: true },
        dependencies: { min_age_days: 60 },
      },
    );
    expect(result.ignored).toEqual([]);
    expect(result.document.coverage?.threshold).toBe(95);
    expect(result.document.test_integrity).toEqual({ mode: "block", signals: { TI01: "block" } });
    expect(result.document.setup).toEqual({ require: true, consistency: "block" });
    expect(result.document.flaky).toEqual({ quarantine: false });
    expect(result.document.dependencies).toEqual({ min_age_days: 90 });
  });

  it("applies the base's keys when the head has no parent object for them, and nothing for a head-only key", () => {
    const result = unite(
      { version: 1 },
      {
        version: 1,
        coverage: { exclude: ["vendor/**"], root: "packages/base" },
        test_integrity: { accept_label: "base-label" },
        policy: { required: true },
        dependencies: { registries: ["npm"], allowed_hosts: ["npm.base.example"] },
        injection: { exempt: ["docs/**"] },
      },
    );
    expect(result.document).toEqual({ version: 1 });
    expect(result.ignored).toEqual([]);
  });

  it("gives the head document and no record for equal copies", () => {
    const result = unite(BASE, BASE);
    expect(result.ignored).toEqual([]);
    expect(result.document.coverage).toEqual(BASE.coverage);
    expect(result.document.agents).toEqual(BASE.agents);
    expect(result.document.setup?.allowed_mcp_servers).toEqual(BASE.setup?.allowed_mcp_servers);
    expect(result.document.injection).toEqual(BASE.injection);
  });

  it("returns the policy unchanged, with no copies and no record, when nothing is united", () => {
    const policy = file(HEAD);
    for (const base of [undefined, { kind: "absent" } as const, { kind: "unreadable" } as const]) {
      const result = uniteFilePolicy(policy, base);
      expect(result.policy).toBe(policy);
      expect(result.ignored).toEqual([]);
    }
    const app: ResolvedPolicy = { source: "app", version: 3, document: HEAD };
    expect(uniteFilePolicy(app, documentBase(BASE))).toEqual({ policy: app, ignored: [] });
    const none: ResolvedPolicy = { source: "none", version: null, document: null };
    expect(uniteFilePolicy(none, documentBase(BASE))).toEqual({ policy: none, ignored: [] });
  });
});
