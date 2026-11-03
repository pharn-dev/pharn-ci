/**
 * The TypeScript parser the Action ships beside its bundle, and the pin that ties the two together.
 *
 * `scripts/bundle.mjs` copies `typescript5`'s `lib/typescript.js` byte for byte to `packages/action/dist/typescript.js`
 * (the Action's `pharnBundle.typescript5` field in package.json), and `vendored-typescript.ts` loads it on the first
 * parse of a test file or test config, only if its sha256 equals the pin below.
 *
 * Refresh these when `typescript5` in packages/core/package.json is bumped: run `pnpm build`, take the sha256 of
 * `packages/action/dist/typescript.js`, confirm it against the new version's npm tarball (`npm pack typescript@<version>`,
 * then the sha256 of `package/lib/typescript.js`), and commit the rebuilt dist files with the new pin.
 */
export const VENDORED_TYPESCRIPT_FILE = "typescript.js";
export const VENDORED_TYPESCRIPT_VERSION = "5.9.3";
export const VENDORED_TYPESCRIPT_SHA256 = "3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675";
