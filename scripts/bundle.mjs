// Bundle a package entry point into one self-contained ESM file.
// Usage: node scripts/bundle.mjs <entry> <outfile> [--shebang]
//
// The entry's package may declare `"pharnBundle": { "typescript5": "<loader source path>" }` in its package.json (the
// nearest one above the entry's own directory). The bundle then does not inline the TypeScript parser: `typescript5`
// is aliased to that loader, and `typescript5`'s lib/typescript.js is copied byte for byte beside the outfile as
// typescript.js, for the loader to read (packages/action/src/vendored-typescript.ts). A package without the field is
// bundled exactly as before, with the parser inlined.

import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const [entry, outfile, ...flags] = process.argv.slice(2);
if (!entry || !outfile) {
  console.error("usage: bundle.mjs <entry> <outfile> [--shebang]");
  process.exit(2);
}

/** The `pharnBundle` field of the package that owns `entry`, or undefined; an unknown key or a bad value fails the build. */
function readPharnBundle(entryPath) {
  let dir = dirname(resolve(entryPath));
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      const field = JSON.parse(readFileSync(manifest, "utf8")).pharnBundle;
      if (field === undefined) return undefined;
      const known = ["typescript5"];
      const unknown =
        field === null || typeof field !== "object"
          ? ["(not an object)"]
          : Object.keys(field).filter((k) => !known.includes(k));
      if (unknown.length > 0 || typeof field.typescript5 !== "string") {
        console.error(
          `bundle.mjs: ${manifest}: pharnBundle must be { "typescript5": "<path>" }; got ${unknown.join(", ") || "no typescript5"}`,
        );
        process.exit(2);
      }
      return { typescript5: resolve(dir, field.typescript5) };
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const pharnBundle = readPharnBundle(entry);

const banner = [
  flags.includes("--shebang") ? "#!/usr/bin/env node" : "",
  // Some bundled CommonJS dependencies call require() on Node builtins.
  'import { createRequire as __pharnCreateRequire } from "node:module";',
  "const require = __pharnCreateRequire(import.meta.url);",
  // The bundled TypeScript parser (CommonJS) reads __filename and __dirname when it loads; ESM has neither.
  "const __filename = import.meta.filename;",
  "const __dirname = import.meta.dirname;",
]
  .filter(Boolean)
  .join("\n");

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // Resolve workspace packages to their TypeScript sources.
  conditions: ["source"],
  ...(pharnBundle ? { alias: { typescript5: pharnBundle.typescript5 } } : {}),
  banner: { js: banner },
  legalComments: "eof",
  logLevel: "warning",
});

if (pharnBundle) {
  // Resolved the way packages/core resolves it, so the copied file is the one the CLI bundle inlines.
  const coreRequire = createRequire(fileURLToPath(new URL("../packages/core/package.json", import.meta.url)));
  copyFileSync(coreRequire.resolve("typescript5/lib/typescript.js"), join(dirname(resolve(outfile)), "typescript.js"));
}
