import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

export function fixture(path: string): string {
  return readFileSync(FIXTURES + path, "utf8");
}
