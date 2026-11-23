/**
 * The version of the build, from the root package.json: scripts/bundle.mjs (the CLI and Action bundles) and
 * vitest.config.ts (tests run from source) both define `__PHARN_VERSION__` to it at build time, so this file holds no
 * version literal and a release edits no code. The CLI and the Action put it in Report v2 (`tool.version`), the upload's
 * meta.json and the User-Agent of the pharn.dev calls.
 */
declare const __PHARN_VERSION__: string;

/** pharn-ci version reported in Report v2 (`tool.version`). */
export const VERSION: string = __PHARN_VERSION__;
