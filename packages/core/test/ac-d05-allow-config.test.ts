import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../src/config.js";

// d05-private-registry-allowlist, AC-6: `.pharn/ci.yml` is carried by the change under review, so it cannot name an
// allowed registry host. Whatever value the key holds, parseConfig() refuses `dependencies.allowed_hosts` with a
// ConfigError that says why and names the workflow input where the setting belongs.

const TEXTS = [
  "dependencies:\n  allowed_hosts: [npm.corp.example]\n",
  "dependencies:\n  allowed_hosts:\n    - npm.corp.example\n",
  "dependencies:\n  allowed_hosts: npm.corp.example\n",
  "dependencies:\n  allowed_hosts:\n",
  "dependencies:\n  lookup: true\n  allowed_hosts: [npm.corp.example, mirror.other.example]\n",
];

function refusal(text: string): Error {
  try {
    parseConfig(text);
  } catch (error) {
    return error as Error;
  }
  throw new Error(`parseConfig accepted ${JSON.stringify(text)}`);
}

describe(".pharn/ci.yml and the allowed hosts", () => {
  it("AC-6: dependencies.allowed_hosts with any value is a ConfigError saying the change under review can edit the file, naming the dependency-allowed-hosts input", () => {
    for (const text of TEXTS) {
      const error = refusal(text);
      expect(error, text).toBeInstanceOf(ConfigError);
      expect(error.message, text).toContain("dependencies.allowed_hosts");
      expect(error.message, text).toMatch(/not a setting/i);
      expect(error.message, text).toMatch(/change under review/i);
      expect(error.message, text).toContain("dependency-allowed-hosts");
    }
  });
});
