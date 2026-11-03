import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// action-bundle-size AC-1: the TypeScript parser leaves packages/action/dist/index.js and ships beside it as
// packages/action/dist/typescript.js, byte-identical to typescript@5.9.3's lib/typescript.js.
//
// The npm-tarball identity rests on the literal below: the sha256 of lib/typescript.js in the typescript@5.9.3
// tarball, which pnpm verifies against the lockfile's sha512 before it unpacks it (no test downloads the tarball). The
// same literal is required of the pnpm-installed copy, of the pin the Action's source commits, of the committed dist
// file and of a fresh bundle's output. The pin module and the fresh bundle are read inside the test bodies: the test is
// written before the build adds them.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ACTION = join(ROOT, "packages/action");
const MAX_INDEX_BYTES = 2_000_000;
const TYPESCRIPT_5_9_3_SHA256 = "3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** The installed `typescript5` package's lib/typescript.js, resolved the way core resolves it. */
function installedTypeScript(): { path: string; version: unknown } {
  const require = createRequire(join(ROOT, "packages/core/package.json"));
  return {
    path: require.resolve("typescript5/lib/typescript.js"),
    version: (require("typescript5/package.json") as { version?: unknown }).version,
  };
}

describe("action-bundle-size: the Action's dist ships the TypeScript parser as its own vendored file", () => {
  it("AC-1: the committed packages/action/dist/index.js is under 2,000,000 bytes and the committed packages/action/dist/typescript.js has the sha256 of typescript@5.9.3's lib/typescript.js, which is the pin in vendored-typescript-pin.ts and the installed copy's", async () => {
    const installed = installedTypeScript();
    expect(installed.version, "the installed typescript5 is 5.9.3").toBe("5.9.3");
    expect(sha256(readFileSync(installed.path)), "the installed lib/typescript.js is the npm 5.9.3 file").toBe(
      TYPESCRIPT_5_9_3_SHA256,
    );

    const { VENDORED_TYPESCRIPT_SHA256 } = (await import("../src/vendored-typescript-pin.js")) as {
      VENDORED_TYPESCRIPT_SHA256: unknown;
    };
    expect(VENDORED_TYPESCRIPT_SHA256, "the pin committed in the Action's source").toBe(TYPESCRIPT_5_9_3_SHA256);

    const index = join(ACTION, "dist/index.js");
    expect(statSync(index).size, "packages/action/dist/index.js size in bytes").toBeLessThan(MAX_INDEX_BYTES);

    const vendored = join(ACTION, "dist/typescript.js");
    expect(existsSync(vendored), "packages/action/dist/typescript.js is committed").toBe(true);
    expect(sha256(readFileSync(vendored)), "packages/action/dist/typescript.js is byte-identical to npm's").toBe(
      TYPESCRIPT_5_9_3_SHA256,
    );
  }, 60_000);

  it("AC-1: a fresh `node scripts/bundle.mjs src/index.ts <out>/index.js` (cwd packages/action) writes an index.js under 2,000,000 bytes and a typescript.js beside it with the sha256 of typescript@5.9.3's lib/typescript.js", () => {
    const out = mkdtempSync(join(tmpdir(), "pharn-ci-ac-bundle-size-dist-"));
    try {
      const outfile = join(out, "index.js");
      execFileSync(process.execPath, ["../../scripts/bundle.mjs", "src/index.ts", outfile], {
        cwd: ACTION,
        stdio: "pipe",
      });
      expect(statSync(outfile).size, "the fresh index.js size in bytes").toBeLessThan(MAX_INDEX_BYTES);
      const vendored = join(out, "typescript.js");
      expect(existsSync(vendored), "the bundler writes typescript.js beside the outfile").toBe(true);
      expect(sha256(readFileSync(vendored)), "the fresh typescript.js is byte-identical to npm's").toBe(
        TYPESCRIPT_5_9_3_SHA256,
      );
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 240_000);
});
