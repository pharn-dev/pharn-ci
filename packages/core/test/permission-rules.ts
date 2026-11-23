// The string forms of the permission-rule comparisons that P02 and P03 use. CORE-123 (R5.6) removed `covers` and
// `overlapsForbidden` from core, where nothing called them (P02 and P03 call `coversPrepared` and `overlapsPrepared`
// on entries they parse once); the grammar and soundness tests still check the comparison through these thin
// wrappers, which are exactly the removed bodies, so they test the code the rules run.

import {
  coversPrepared,
  overlapsPrepared,
  prepareEntry,
  preparePolicyEntry,
} from "../src/policy/settings/permissionRule.js";

/** The settings entry `a` (read broad for p02, narrow for p03) against the policy entry `f`. */
export function covers(a: string, f: string, reading: "p02" | "p03"): boolean {
  return coversPrepared(prepareEntry(a, reading === "p02" ? "allow" : "deny"), preparePolicyEntry(f), reading);
}

/** C1: the allow entry is equal to or broader than the forbidden one, or the forbidden one is broader than it. */
export function overlapsForbidden(allow: string, forbidden: string): boolean {
  return overlapsPrepared(prepareEntry(allow, "allow"), preparePolicyEntry(forbidden));
}
