// Bundle a package entry point into one self-contained ESM file.
// Usage: node scripts/bundle.mjs <entry> <outfile> [--shebang]
import { build } from "esbuild";

const [entry, outfile, ...flags] = process.argv.slice(2);
if (!entry || !outfile) {
  console.error("usage: bundle.mjs <entry> <outfile> [--shebang]");
  process.exit(2);
}

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
  banner: { js: banner },
  legalComments: "eof",
  logLevel: "warning",
});
