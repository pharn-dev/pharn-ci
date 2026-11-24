import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import type { TestSourceFile as SourceFile } from "../src/testSources.js";
import { byCodeUnit } from "../src/text.js";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import type { TextCheckInput } from "./text-coverage.js";

// CORE-145 part A, AC-1. check() is loaded inside the test body: the AC test is written before the pairing is rebuilt
// as one bounded loop, so nothing the build changes may run while this file loads.
//
// What must stay: every fixture under fixtures/test-integrity/TI01, TI02, TI05 and TI06, run in modes block and warn,
// gives the TI01, TI02, TI05 and TI06 signals and the TEST_INTEGRITY_* messages the code at base commit cd16f787 gave.
// EXPECTED is a readable summary of them (id, severity, path:line; message code and level); DIGEST pins every byte of
// those signals and messages (details and fix objects included), both taken at cd16f787. What must change: the moved
// test file matcher is folded into matchTests, so the module packages/core/src/signals/ti01Moved.js no longer exists.
//
// The inputs: a `.diff` fixture runs with the files of test-files-deleted and no sources; a case directory runs with its
// change.diff, its files.txt (else its head paths and src/cart.ts) and, when it has a base or head directory, those
// texts as the test sources. No Python index is passed: a Python fixture gives the INDEX_UNAVAILABLE it gave at base.
// Python pairing through the real interpreter is pinned by the node-io suites (ac-ti0205-python, ac-ti07-moved).

const REPO_ROOT = "/home/runner/work/demo/demo";
const DIRS = ["TI01", "TI02", "TI05", "TI06"] as const;
const IDS: ReadonlySet<string> = new Set(DIRS);
const MODES = ["block", "warn"] as const;
/** The module the build deletes, and two controls that show a specifier held in a variable resolves from here. */
const GONE = "../src/signals/ti01Moved.js";
const KEPT = "../src/signals/sameGroupRules.js";
const NEVER = "../src/signals/noSuchPairingModule.js";

/**
 * sha256 of the JSON list of { fixture, mode, signals, messages } over the cases below, in directory then name order,
 * mode block then warn, as check() gave them at cd16f787 (signals: TI01, TI02, TI05, TI06; messages: TEST_INTEGRITY_*),
 * except CORE-356: the two records of TI05/pass-pytest-alias-emptied-skipped (no Python index, so its aliased skip is no
 * longer resolved) lost their TEST_INTEGRITY_TI03 message. The old digest was d80a3ed005c02ae0…; EXPECTED below changed
 * in exactly those two lines.
 */
const DIGEST = "74ee661481e00094246528efe82c5ce2ad9c5dedd658f52e709947556e49f31f";

/** `<fixture> <mode>: <signals then messages>`, as check() gave them at cd16f787. */
const EXPECTED: readonly string[] = [
  "TI01/block-binary-gitattributes-deleted block: TI01 block src/cart.test.ts:null; TEST_INTEGRITY_TI01 error",
  "TI01/block-binary-gitattributes-deleted warn: TI01 warn src/cart.test.ts:null; TEST_INTEGRITY_TI01 warn",
  "TI01/block-binary-go-deleted block: TI01 block pkg/cart_test.go:null; TEST_INTEGRITY_TI01 error",
  "TI01/block-binary-go-deleted warn: TI01 warn pkg/cart_test.go:null; TEST_INTEGRITY_TI01 warn",
  "TI01/block-binary-py-deleted block: TI01 block tests/test_cart.py:null; TEST_INTEGRITY_TI01 error",
  "TI01/block-binary-py-deleted warn: TI01 warn tests/test_cart.py:null; TEST_INTEGRITY_TI01 warn",
  "TI01/block-binary-renamed-away block: TI01 block src/cart.test.ts:null; TEST_INTEGRITY_TI01 error",
  "TI01/block-binary-renamed-away warn: TI01 warn src/cart.test.ts:null; TEST_INTEGRITY_TI01 warn",
  "TI01/block-binary-spec-mjs-deleted block: TI01 block src/cart.spec.mjs:null; TEST_INTEGRITY_TI01 error",
  "TI01/block-binary-spec-mjs-deleted warn: TI01 warn src/cart.spec.mjs:null; TEST_INTEGRITY_TI01 warn",
  "TI01/block-binary-test-cts-deleted block: TI01 block src/cart.test.cts:null; TEST_INTEGRITY_TI01 error",
  "TI01/block-binary-test-cts-deleted warn: TI01 warn src/cart.test.cts:null; TEST_INTEGRITY_TI01 warn",
  "TI01/block-code-stays.diff block: TI01 block src/__tests__/b.test.ts:null; TEST_INTEGRITY_TI01 error",
  "TI01/block-code-stays.diff warn: TI01 warn src/__tests__/b.test.ts:null; TEST_INTEGRITY_TI01 warn",
  "TI01/block-package-code-stays block: TI01 block src/cart/cart.test.ts:null; TEST_INTEGRITY_TI01 error",
  "TI01/block-package-code-stays warn: TI01 warn src/cart/cart.test.ts:null; TEST_INTEGRITY_TI01 warn",
  "TI01/block-package-notes-deleted block: TI01 block src/cart/cart.test.ts:null; TEST_INTEGRITY_TI01 error",
  "TI01/block-package-notes-deleted warn: TI01 warn src/cart/cart.test.ts:null; TEST_INTEGRITY_TI01 warn",
  "TI01/block-rename-away-edited.diff block: TI01 block src/user.test.ts:null; TEST_INTEGRITY_TI01 error",
  "TI01/block-rename-away-edited.diff warn: TI01 warn src/user.test.ts:null; TEST_INTEGRITY_TI01 warn",
  "TI01/block-rename-away.diff block: TI01 block src/x.test.ts:null; TEST_INTEGRITY_TI01 error",
  "TI01/block-rename-away.diff warn: TI01 warn src/x.test.ts:null; TEST_INTEGRITY_TI01 warn",
  "TI01/block-rename-into-test-dir block: TI01 block src/cart.test.ts:null; TEST_INTEGRITY_TI01 error",
  "TI01/block-rename-into-test-dir warn: TI01 warn src/cart.test.ts:null; TEST_INTEGRITY_TI01 warn",
  "TI01/block-rename-py-to-txt block: TI01 block tests/test_cart.py:null; TEST_INTEGRITY_TI01 error",
  "TI01/block-rename-py-to-txt warn: TI01 warn tests/test_cart.py:null; TEST_INTEGRITY_TI01 warn",
  "TI01/block-root-tests.diff block: TI01 block tests/test_a.py:null; TEST_INTEGRITY_TI01 error",
  "TI01/block-root-tests.diff warn: TI01 warn tests/test_a.py:null; TEST_INTEGRITY_TI01 warn",
  "TI01/block-same-stem-dropped block: TI01 block src/cart.test.ts:null; TEST_INTEGRITY_TI01 error",
  "TI01/block-same-stem-dropped warn: TI01 warn src/cart.test.ts:null; TEST_INTEGRITY_TI01 warn",
  "TI01/block-same-stem-unparsed block: TI01 block src/cart.test.ts:null; TEST_INTEGRITY_TI01 error",
  "TI01/block-same-stem-unparsed warn: TI01 warn src/cart.test.ts:null; TEST_INTEGRITY_TI01 warn",
  "TI01/block-spec-cts-deleted block: TI01 block src/cart.spec.cts:null; TEST_INTEGRITY_TI01 error",
  "TI01/block-spec-cts-deleted warn: TI01 warn src/cart.spec.cts:null; TEST_INTEGRITY_TI01 warn",
  "TI01/block-test-mts-deleted block: TI01 block src/cart.test.mts:null; TEST_INTEGRITY_TI01 error",
  "TI01/block-test-mts-deleted warn: TI01 warn src/cart.test.mts:null; TEST_INTEGRITY_TI01 warn",
  "TI01/info-migration-mjs.diff block: TI01 block lib/x.test.js:null; TEST_INTEGRITY_TI01 error",
  "TI01/info-migration-mjs.diff warn: TI01 warn lib/x.test.js:null; TEST_INTEGRITY_TI01 warn",
  "TI01/info-migration-ts.diff block: TI01 block lib/x.test.js:null; TEST_INTEGRITY_TI01 error",
  "TI01/info-migration-ts.diff warn: TI01 warn lib/x.test.js:null; TEST_INTEGRITY_TI01 warn",
  "TI01/info-package-deleted-whole block: TI01 info src/cart/cart.test.ts:null; TEST_INTEGRITY_TI01 info",
  "TI01/info-package-deleted-whole warn: TI01 info src/cart/cart.test.ts:null; TEST_INTEGRITY_TI01 info",
  "TI01/info-package-removed.diff block: TI01 info packages/a/__tests__/y.test.ts:null; TEST_INTEGRITY_TI01 info",
  "TI01/info-package-removed.diff warn: TI01 info packages/a/__tests__/y.test.ts:null; TEST_INTEGRITY_TI01 info",
  "TI01/info-same-stem-code-stays block: TI01 info src/cart/cart.test.ts:null; TEST_INTEGRITY_TI01 info",
  "TI01/info-same-stem-code-stays warn: TI01 info src/cart/cart.test.ts:null; TEST_INTEGRITY_TI01 info",
  "TI01/info-with-source.diff block: TI01 info src/foo.test.ts:null; TEST_INTEGRITY_TI01 info",
  "TI01/info-with-source.diff warn: TI01 info src/foo.test.ts:null; TEST_INTEGRITY_TI01 info",
  "TI01/pass-binary-not-test-deleted block: none",
  "TI01/pass-binary-not-test-deleted warn: none",
  "TI01/pass-binary.diff block: TI01 block tests/img.test.ts:null; TEST_INTEGRITY_TI01 error",
  "TI01/pass-binary.diff warn: TI01 warn tests/img.test.ts:null; TEST_INTEGRITY_TI01 warn",
  "TI01/pass-fixture-json.diff block: none",
  "TI01/pass-fixture-json.diff warn: none",
  "TI01/pass-helper-renamed-in-tests block: none",
  "TI01/pass-helper-renamed-in-tests warn: none",
  "TI01/pass-helper.diff block: none",
  "TI01/pass-helper.diff warn: none",
  "TI01/pass-init-py.diff block: none",
  "TI01/pass-init-py.diff warn: none",
  "TI01/pass-rename-into-test-dir block: none",
  "TI01/pass-rename-into-test-dir warn: none",
  "TI01/pass-rename-test-to-spec block: none",
  "TI01/pass-rename-test-to-spec warn: none",
  "TI01/pass-rename-to-test-edited.diff block: none",
  "TI01/pass-rename-to-test-edited.diff warn: none",
  "TI02/block-common-leaf-elsewhere block: TI02 block src/a.test.ts:4; TEST_INTEGRITY_TI02 error",
  "TI02/block-common-leaf-elsewhere warn: TI02 warn src/a.test.ts:4; TEST_INTEGRITY_TI02 warn",
  "TI02/block-duplicate-name block: TI02 block src/cart.test.ts:8; TEST_INTEGRITY_TI02 error",
  "TI02/block-duplicate-name warn: TI02 warn src/cart.test.ts:8; TEST_INTEGRITY_TI02 warn",
  "TI02/block-pytest-alias-marked-removed block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI02/block-pytest-alias-marked-removed warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI02/block-pytest-alias-marked-removed-literal block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI02/block-pytest-alias-marked-removed-literal warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI02/block-pytest-removed block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI02/block-pytest-removed warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI02/block-removed-describe block: TI02 block src/cart.test.ts:17; TI02 block src/cart.test.ts:21; TI02 block src/cart.test.ts:25; TEST_INTEGRITY_TI02 error",
  "TI02/block-removed-describe warn: TI02 warn src/cart.test.ts:17; TI02 warn src/cart.test.ts:21; TI02 warn src/cart.test.ts:25; TEST_INTEGRITY_TI02 warn",
  "TI02/block-removed-it block: TI02 block src/cart.test.ts:9; TEST_INTEGRITY_TI02 error",
  "TI02/block-removed-it warn: TI02 warn src/cart.test.ts:9; TEST_INTEGRITY_TI02 warn",
  "TI02/block-renamed-file block: TI02 block src/cart.test.ts:9; TEST_INTEGRITY_TI02 error",
  "TI02/block-renamed-file warn: TI02 warn src/cart.test.ts:9; TEST_INTEGRITY_TI02 warn",
  "TI02/block-replaced-dissimilar block: TI02 block src/cart.test.ts:9; TEST_INTEGRITY_TI02 error",
  "TI02/block-replaced-dissimilar warn: TI02 warn src/cart.test.ts:9; TEST_INTEGRITY_TI02 warn",
  "TI02/block-unittest-method-removed block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI02/block-unittest-method-removed warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI02/pass-became-todo block: TEST_INTEGRITY_TI03 error",
  "TI02/pass-became-todo warn: TEST_INTEGRITY_TI03 warn",
  "TI02/pass-body-rewritten block: none",
  "TI02/pass-body-rewritten warn: none",
  "TI02/pass-deleted-file block: TI01 block src/old.test.ts:null; TEST_INTEGRITY_TI01 error",
  "TI02/pass-deleted-file warn: TI01 warn src/old.test.ts:null; TEST_INTEGRITY_TI01 warn",
  "TI02/pass-describe-renamed block: none",
  "TI02/pass-describe-renamed warn: none",
  "TI02/pass-each-table-edited block: none",
  "TI02/pass-each-table-edited warn: none",
  "TI02/pass-moved-in-file block: none",
  "TI02/pass-moved-in-file warn: none",
  "TI02/pass-moved-to-added-file block: none",
  "TI02/pass-moved-to-added-file warn: none",
  "TI02/pass-moved-to-other-file block: TI02 block src/a.test.ts:8; TEST_INTEGRITY_TI02 error",
  "TI02/pass-moved-to-other-file warn: TI02 warn src/a.test.ts:8; TEST_INTEGRITY_TI02 warn",
  "TI02/pass-pytest-alias-fixture-removed block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI02/pass-pytest-alias-fixture-removed warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI02/pass-pytest-alias-fixture-removed-literal block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI02/pass-pytest-alias-fixture-removed-literal warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI02/pass-pytest-renamed block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI02/pass-pytest-renamed warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI02/pass-renamed-edited-literal block: none",
  "TI02/pass-renamed-edited-literal warn: none",
  "TI02/pass-renamed-same-body block: none",
  "TI02/pass-renamed-same-body warn: none",
  "TI02/pass-template-renamed block: none",
  "TI02/pass-template-renamed warn: none",
  "TI02/pass-two-works-kept block: none",
  "TI02/pass-two-works-kept warn: none",
  "TI02/warn-each-removed block: TI02 warn src/cart.test.ts:8; TEST_INTEGRITY_TI02 warn",
  "TI02/warn-each-removed warn: TI02 warn src/cart.test.ts:8; TEST_INTEGRITY_TI02 warn",
  "TI05/block-emptied block: TI05 block src/cart.test.ts:13; TEST_INTEGRITY_TI05 error",
  "TI05/block-emptied warn: TI05 warn src/cart.test.ts:13; TEST_INTEGRITY_TI05 warn",
  "TI05/block-guard-only block: TI05 block src/cart.test.ts:13; TEST_INTEGRITY_TI05 error",
  "TI05/block-guard-only warn: TI05 warn src/cart.test.ts:13; TEST_INTEGRITY_TI05 warn",
  "TI05/block-pytest-alias-raises-removed block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI05/block-pytest-alias-raises-removed warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI05/block-pytest-alias-raises-removed-literal block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI05/block-pytest-alias-raises-removed-literal warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI05/block-pytest-emptied block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI05/block-pytest-emptied warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI05/block-pytest-skipif-emptied block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI05/block-pytest-skipif-emptied warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI05/block-runif-true-emptied block: TI05 block src/cart.test.ts:9; TEST_INTEGRITY_TI05 error",
  "TI05/block-runif-true-emptied warn: TI05 warn src/cart.test.ts:9; TEST_INTEGRITY_TI05 warn",
  "TI05/block-skipif-false-emptied block: TI05 block src/cart.test.ts:9; TEST_INTEGRITY_TI05 error",
  "TI05/block-skipif-false-emptied warn: TI05 warn src/cart.test.ts:9; TEST_INTEGRITY_TI05 warn",
  "TI05/pass-became-skip block: TEST_INTEGRITY_TI03 error",
  "TI05/pass-became-skip warn: TEST_INTEGRITY_TI03 warn",
  "TI05/pass-became-todo block: TEST_INTEGRITY_TI03 error",
  "TI05/pass-became-todo warn: TEST_INTEGRITY_TI03 warn",
  "TI05/pass-count-grows block: none",
  "TI05/pass-count-grows warn: none",
  "TI05/pass-fewer-rewritten block: none",
  "TI05/pass-fewer-rewritten warn: none",
  "TI05/pass-none-at-base block: none",
  "TI05/pass-none-at-base warn: none",
  // CORE-356: this case runs with no Python index, so the aliased `@pt.mark.skip` is no longer resolved (aliases come from
  // the index only) and its TI03 is gone in both modes; the `-literal` twin below keeps it. The same fixture through the
  // real index still gives the TI03 (packages/node-io/test/ac-pyparity2-index-signals.test.ts, and the AC-1 test of
  // packages/node-io/test/ac-core356-audit-parity.test.ts).
  "TI05/pass-pytest-alias-emptied-skipped block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI05/pass-pytest-alias-emptied-skipped warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI05/pass-pytest-alias-emptied-skipped-literal block: TEST_INTEGRITY_TI03 error; TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI05/pass-pytest-alias-emptied-skipped-literal warn: TEST_INTEGRITY_TI03 warn; TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI05/pass-pytest-skip-emptied block: TEST_INTEGRITY_TI03 error; TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI05/pass-pytest-skip-emptied warn: TEST_INTEGRITY_TI03 warn; TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI05/pass-pytest-skipif-unchanged block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI05/pass-pytest-skipif-unchanged warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI05/pass-removed-with-rewrite block: none",
  "TI05/pass-removed-with-rewrite warn: none",
  "TI05/pass-skipif-unchanged block: none",
  "TI05/pass-skipif-unchanged warn: none",
  "TI05/warn-helper-assert block: TI05 warn src/cart.test.ts:9; TEST_INTEGRITY_TI05 warn",
  "TI05/warn-helper-assert warn: TI05 warn src/cart.test.ts:9; TEST_INTEGRITY_TI05 warn",
  "TI05/warn-helper-check block: TI05 warn src/cart.test.ts:9; TEST_INTEGRITY_TI05 warn",
  "TI05/warn-helper-check warn: TI05 warn src/cart.test.ts:9; TEST_INTEGRITY_TI05 warn",
  "TI05/warn-helper-expect block: TI05 warn src/cart.test.ts:9; TEST_INTEGRITY_TI05 warn",
  "TI05/warn-helper-expect warn: TI05 warn src/cart.test.ts:9; TEST_INTEGRITY_TI05 warn",
  "TI05/warn-helper-this-verify block: TI05 warn src/cart.test.ts:9; TEST_INTEGRITY_TI05 warn",
  "TI05/warn-helper-this-verify warn: TI05 warn src/cart.test.ts:9; TEST_INTEGRITY_TI05 warn",
  "TI05/warn-one-removed block: TI05 warn src/cart.test.ts:9; TEST_INTEGRITY_TI05 warn",
  "TI05/warn-one-removed warn: TI05 warn src/cart.test.ts:9; TEST_INTEGRITY_TI05 warn",
  "TI06/pass-added-tests block: none",
  "TI06/pass-added-tests warn: none",
  "TI06/pass-be-type-of-to-typeof block: none",
  "TI06/pass-be-type-of-to-typeof warn: none",
  "TI06/pass-became-skip block: TEST_INTEGRITY_TI03 error",
  "TI06/pass-became-skip warn: TEST_INTEGRITY_TI03 warn",
  "TI06/pass-chai block: none",
  "TI06/pass-chai warn: none",
  "TI06/pass-cross-file block: TI02 block src/a.test.ts:5; TEST_INTEGRITY_TI02 error",
  "TI06/pass-cross-file warn: TI02 warn src/a.test.ts:5; TEST_INTEGRITY_TI02 warn",
  "TI06/pass-guard-raised block: none",
  "TI06/pass-guard-raised warn: none",
  "TI06/pass-instanceof-equivalent block: none",
  "TI06/pass-instanceof-equivalent warn: none",
  "TI06/pass-length-equivalent block: none",
  "TI06/pass-length-equivalent warn: none",
  "TI06/pass-neutral-matchers block: none",
  "TI06/pass-neutral-matchers warn: none",
  "TI06/pass-py-equal-to-assert block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI06/pass-py-equal-to-assert warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI06/pass-pytest-skip-weakened block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI06/pass-pytest-skip-weakened warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI06/pass-skip-weakened block: none",
  "TI06/pass-skip-weakened warn: none",
  "TI06/pass-strict-equal block: none",
  "TI06/pass-strict-equal warn: none",
  "TI06/pass-tobe-toequal block: none",
  "TI06/pass-tobe-toequal warn: none",
  "TI06/pass-tothrow-narrowed block: none",
  "TI06/pass-tothrow-narrowed warn: none",
  "TI06/pass-truthy-beside block: none",
  "TI06/pass-truthy-beside warn: none",
  "TI06/pass-truthy-coercion block: none",
  "TI06/pass-truthy-coercion warn: none",
  "TI06/pass-try-kept block: none",
  "TI06/pass-try-kept warn: none",
  "TI06/pass-typeof-to-be-type-of block: none",
  "TI06/pass-typeof-to-be-type-of warn: none",
  "TI06/warn-assert-ok block: TI06 warn src/cart.test.ts:6; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-assert-ok warn: TI06 warn src/cart.test.ts:6; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-called-with block: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-called-with warn: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-early-return block: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-early-return warn: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-guard-lowered block: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-guard-lowered warn: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-guard-removed block: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-guard-removed warn: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-has-assertions-removed block: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-has-assertions-removed warn: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-joined block: TI06 warn src/cart.test.ts:5; TI06 warn src/cart.test.ts:11; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-joined warn: TI06 warn src/cart.test.ts:5; TI06 warn src/cart.test.ts:11; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-null-not-undefined block: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-null-not-undefined warn: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-property-instance block: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-property-instance warn: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-py-assert-true block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI06/warn-py-assert-true warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI06/warn-py-assert-truthy block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI06/warn-py-assert-truthy warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI06/warn-py-tautology block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI06/warn-py-tautology warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI06/warn-pytest-alias-approx-truthy block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI06/warn-pytest-alias-approx-truthy warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI06/warn-pytest-alias-approx-truthy-literal block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI06/warn-pytest-alias-approx-truthy-literal warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI06/warn-pytest-skipif-weakened block: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI06/warn-pytest-skipif-weakened warn: TEST_INTEGRITY_INDEX_UNAVAILABLE warn",
  "TI06/warn-skipif-weakened block: TI06 warn src/cart.test.ts:7; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-skipif-weakened warn: TI06 warn src/cart.test.ts:7; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-soft-truthy block: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-soft-truthy warn: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-tautology-assert block: TI06 warn src/cart.test.ts:6; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-tautology-assert warn: TI06 warn src/cart.test.ts:6; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-tautology-expect block: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-tautology-expect warn: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-to-be-to-type-of block: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-to-be-to-type-of warn: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-tobe-truthy block: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-tobe-truthy warn: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-toequal-defined block: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-toequal-defined warn: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-tothrow-bare block: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-tothrow-bare warn: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-try-catch block: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
  "TI06/warn-try-catch warn: TI06 warn src/cart.test.ts:5; TEST_INTEGRITY_TI06 warn",
];

/** The `<logical path>.txt` files under one side of a case directory, sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort((a, b) => byCodeUnit(a.path, b.path));
}

type CaseInput = Pick<TextCheckInput, "diff" | "repoFiles"> & Partial<TextCheckInput>;

/** Every case of the four directories, in directory then name order, with the inputs described above. */
function cases(): Array<[string, CaseInput]> {
  const out: Array<[string, CaseInput]> = [];
  for (const dir of DIRS) {
    for (const name of readdirSync(`${FIXTURES}test-integrity/${dir}`).sort(byCodeUnit)) {
      const path = `${FIXTURES}test-integrity/${dir}/${name}`;
      if (name.endsWith(".diff")) {
        out.push([
          `${dir}/${name}`,
          {
            diff: { text: readFileSync(path, "utf8") },
            repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
          },
        ]);
        continue;
      }
      if (!statSync(path).isDirectory()) continue;
      const base = sideFiles(`${path}/base`);
      const head = sideFiles(`${path}/head`);
      let repoFiles: string[];
      try {
        repoFiles = readFileSync(`${path}/files.txt`, "utf8").trim().split("\n");
      } catch {
        repoFiles = [...new Set([...head.map((f) => f.path), "src/cart.ts"])].sort(byCodeUnit);
      }
      const hasSides = base.length > 0 || head.length > 0;
      out.push([
        `${dir}/${name}`,
        {
          diff: { text: readFileSync(`${path}/change.diff`, "utf8") },
          repoFiles,
          ...(hasSides
            ? { testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } } }
            : {}),
        },
      ]);
    }
  }
  return out;
}

describe("the simpler pairing leaves every TI01, TI02, TI05 and TI06 fixture's answer alone", () => {
  it("AC-1: every TI01, TI02, TI05 and TI06 fixture gives its base-commit signals and TEST_INTEGRITY_* messages in modes block and warn, every report validates, and the ti01Moved module is gone", async () => {
    const { check } = await import("./text-coverage.js");
    const records: Array<{ fixture: string; mode: string; signals: unknown; messages: unknown }> = [];
    const summary: string[] = [];
    for (const [name, input] of cases()) {
      for (const mode of MODES) {
        const report: Report = check({
          version: "0.1.0",
          coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
          repoRoot: REPO_ROOT,
          threshold: 80,
          testIntegrityMode: { input: mode },
          ...input,
        });
        expectValidReport(report);
        const signals = report.testIntegrity.signals.filter((s) => IDS.has(s.id));
        const messages = report.messages.filter((m) => m.code.startsWith("TEST_INTEGRITY_"));
        records.push({ fixture: name, mode, signals, messages });
        const lines = [
          ...signals.map((s) => `${s.id} ${s.severity} ${s.path}:${s.line}`),
          ...messages.map((m) => `${m.code} ${m.level}`),
        ];
        summary.push(`${name} ${mode}: ${lines.length > 0 ? lines.join("; ") : "none"}`);
      }
    }
    expect(records.length, "every fixture ran in both modes").toBe(EXPECTED.length);
    expect(summary, "each fixture's signals and messages, as at cd16f787").toEqual(EXPECTED);
    expect(
      createHash("sha256").update(JSON.stringify(records)).digest("hex"),
      "every byte of those signals and messages, as at cd16f787",
    ).toBe(DIGEST);

    // A specifier held in a variable resolves from this file: a module that stays loads, one that never existed does not.
    const kept = (await import(/* @vite-ignore */ KEPT)) as Record<string, unknown>;
    expect(typeof kept.renameInPlace, "control: a module that stays loads through a variable specifier").toBe(
      "function",
    );
    await expect(
      import(/* @vite-ignore */ NEVER),
      "control: a module that never existed does not load",
    ).rejects.toThrow();
    await expect(
      import(/* @vite-ignore */ GONE),
      "the moved-file matcher is folded into matchTests: ti01Moved.js no longer exists",
    ).rejects.toThrow();
  }, 120_000);
});
