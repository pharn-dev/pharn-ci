/**
 * The fixed detail sentences of a finding on a file that git shows as binary (CORE-50), kept in one place so that the
 * signals that give them and the renderer that picks a hint for them share one source. Plain data and one pure
 * function: no imports, no I/O. No file content ever reaches a detail.
 */

/** TI01: a deleted test file that git shows as binary. */
export const BINARY_DELETED_DETAIL = "Test file deleted; git shows it as binary, so its text was not read.";

/** TI01: a test file renamed away that git shows as binary. */
export const BINARY_RENAMED_AWAY_DETAIL = "Test file renamed away; git shows it as binary, so its text was not read.";

/** TI10, TI11 and TI14: a file whose changes git shows as binary, so no line of it could be read. */
export const BINARY_CHANGES_DETAIL = "git shows this file as binary, so its changes could not be read.";

const BINARY_DETAILS: readonly string[] = [BINARY_DELETED_DETAIL, BINARY_RENAMED_AWAY_DETAIL, BINARY_CHANGES_DETAIL];

/** Whether `detail` is one of the three fixed binary sentences. */
export function isBinaryDetail(detail: string): boolean {
  return BINARY_DETAILS.includes(detail);
}
