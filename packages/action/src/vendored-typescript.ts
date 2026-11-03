import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { compileFunction } from "node:vm";
import { VENDORED_TYPESCRIPT_FILE, VENDORED_TYPESCRIPT_SHA256 } from "./vendored-typescript-pin.js";

/**
 * Stands in for `import ts from "typescript5"` in the Action's bundle (the alias in package.json's `pharnBundle`).
 *
 * The parser is not in the bundle: it sits beside it as `typescript.js`. The first property read of the default export
 * loads it: the file is read once, its sha256 must equal the pin, and the very bytes that were hashed are evaluated
 * (never a second read). From then on the exported binding IS the loaded module, so every later read is a direct
 * property read and no trap runs. A run that never reads a property (no test file or test config to parse) never reads
 * the file.
 *
 * A failure to read, verify or evaluate the file is kept: every later read throws the same error and the file is not
 * read again, and `vendoredTypeScriptFailure()` reports it, so the run can fail instead of carrying on without a parser.
 * The check ties the file to the committed bundle, which names the pin; it is a consistency check between two committed
 * files, not tamper-proofing of a checkout whose files an attacker controls (docs/THREAT-MODEL.md, G1).
 */
export interface VendoredTypeScript {
  /** A stand-in whose first property read loads the file. */
  readonly placeholder: unknown;
  /** The error text of a failed load, or undefined while none has failed. */
  failure(): string | undefined;
}

type LoadState = { readonly module: unknown } | { readonly error: Error };

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reads `path` once, checks it against `sha256` and evaluates those bytes as a CommonJS module in this context. */
function loadModule(path: string, sha256: string): unknown {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (err) {
    throw new Error(`cannot read the vendored TypeScript parser ${path}: ${describe(err)}`);
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256) {
    throw new Error(
      `the vendored TypeScript parser ${path} has sha256 ${actual}, but the Action pins ${sha256}; ` +
        "this copy of the Action is corrupted or was tampered with, and nothing was reported",
    );
  }
  try {
    // No parsingContext: the file runs in the current context, so an error it throws (a RangeError on a stack
    // overflow, say) is this realm's own and `instanceof RangeError` holds where the test index checks it.
    const params = ["exports", "require", "module", "__filename", "__dirname"];
    const wrapper = compileFunction(bytes.toString("utf8"), params, { filename: path });
    const module = { exports: {} as unknown };
    wrapper.call(module.exports, module.exports, createRequire(path), module, path, dirname(path));
    // The file assigns `module.exports`, so it is read after the evaluation.
    return module.exports;
  } catch (err) {
    throw new Error(`the vendored TypeScript parser ${path} failed to load: ${describe(err)}`);
  }
}

/** `onLoad` is called once, with the loaded module, before the read that triggered the load returns. */
export function createVendoredTypeScript(
  path: string,
  sha256: string,
  onLoad: (module: unknown) => void,
): VendoredTypeScript {
  let state: LoadState | undefined;
  const load = (): unknown => {
    if (state === undefined) {
      try {
        const module = loadModule(path, sha256);
        onLoad(module);
        state = { module };
      } catch (err) {
        state = { error: err instanceof Error ? err : new Error(String(err)) };
      }
    }
    if ("error" in state) throw state.error;
    return state.module;
  };
  const placeholder = new Proxy(
    {},
    {
      get: (_target, property) => Reflect.get(load() as object, property),
    },
  );
  return {
    placeholder,
    failure: () => (state !== undefined && "error" in state ? state.error.message : undefined),
  };
}

let ts: unknown;
const vendored = createVendoredTypeScript(
  join(import.meta.dirname, VENDORED_TYPESCRIPT_FILE),
  VENDORED_TYPESCRIPT_SHA256,
  (module) => {
    ts = module;
  },
);
ts = vendored.placeholder;

/** TypeScript (the pinned version), as a live binding: the placeholder until the first read, then the module. */
export { ts as default };
export const vendoredTypeScriptFailure: () => string | undefined = vendored.failure;
