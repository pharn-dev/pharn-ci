import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// precision-corpus-freeze: the early-stop test of scripts/corpus-freeze.mjs. A PR's merge time is never later than
// its last update, so paging may stop only once a page's last PR was updated strictly before the count-th newest
// kept merge time. Loaded inside the test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = pathToFileURL(`${ROOT}scripts/corpus-freeze.mjs`).href;

describe("precision-corpus-freeze: shouldStopPaging", () => {
  it("AC-7: shouldStopPaging is false while fewer than count PRs are kept, whatever the update time", async () => {
    const { shouldStopPaging } = await import(SCRIPT);
    const kept = ["2026-05-20T00:00:00Z", "2026-05-15T00:00:00Z"];
    for (const updatedAt of ["2020-01-01T00:00:00Z", "2026-05-15T00:00:00Z", "2030-01-01T00:00:00Z"]) {
      expect(shouldStopPaging(3, kept, updatedAt), updatedAt).toBe(false);
    }
  });

  it("AC-7: shouldStopPaging is true only when the update time is strictly earlier than the count-th newest kept merge time", async () => {
    const { shouldStopPaging } = await import(SCRIPT);
    // Out of order on purpose; newest first they are 05-20, 05-15, 05-10, 05-01, so the third-newest is 05-10.
    const kept = ["2026-05-10T00:00:00Z", "2026-05-20T00:00:00Z", "2026-05-01T00:00:00Z", "2026-05-15T00:00:00Z"];
    expect(shouldStopPaging(3, kept, "2026-05-10T00:00:00Z"), "equal").toBe(false);
    expect(shouldStopPaging(3, kept, "2026-05-12T00:00:00Z"), "later").toBe(false);
    expect(shouldStopPaging(3, kept, "2026-05-09T23:59:59Z"), "one second earlier").toBe(true);
  });
});
