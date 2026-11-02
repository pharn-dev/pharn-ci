import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Review finding 25: the skylos-nine fixtures are the benchmark the test-integrity signals are measured against, so a
// silent edit to one would move the benchmark under the tests that read it. Every file under fixtures/skylos-nine/ is
// pinned here by sha256, and the set of files is pinned too. `fixtures/** -text` (.gitattributes) keeps the bytes the
// same on every checkout.
//
// When a fixture changes on purpose, update its pin here in the same change, deliberately, and say why in the PR.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DIR = "fixtures/skylos-nine";

const PINS: Readonly<Record<string, string>> = {
  "added-skip/change.diff": "0cccf34c0c883f37819d93e2a5eb4195922fff8f06261afee8d03fe2943175c1",
  "added-skip/files.txt": "91f16715ac24ecfc68e352f43494dd518abe38cb1801566be8e037094aaf2d41",
  "always-true-matcher/change.diff": "34dd1da1c323622887812fa2fc02695ec937d069cd948ddd8a4d411cef21195d",
  "always-true-matcher/files.txt": "91f16715ac24ecfc68e352f43494dd518abe38cb1801566be8e037094aaf2d41",
  "deleted-test/change.diff": "40f9e1fa375ecc9d5614252c37c467896a9e7a36fd115921622f7eec5a85a051",
  "deleted-test/files.txt": "5993b94dd044f74db164a2332bf71e2cd8549cb94a9d954578b97de000685ee2",
  "deselect-setting/change.diff": "0e6f346c3f4325d66167c5d6e6cc36d166004959f549103ca7188f12dbd9d81c",
  "deselect-setting/files.txt": "91f16715ac24ecfc68e352f43494dd518abe38cb1801566be8e037094aaf2d41",
  "edited-expected-value/change.diff": "373c93d0996bac438f55d20f27941f4558d79d4bd9bc8e37967d8267e48ec15e",
  "edited-expected-value/files.txt": "91f16715ac24ecfc68e352f43494dd518abe38cb1801566be8e037094aaf2d41",
  "emptied-assertion/change.diff": "223706c5ef1e8b4302ca1e1a1c3c895e614ae945be844c9c91f10f16c78c145a",
  "emptied-assertion/files.txt": "91f16715ac24ecfc68e352f43494dd518abe38cb1801566be8e037094aaf2d41",
  "hard-coded-answer/change.diff": "5127e6334297e0c2f7f639ec1ca0f2a9edf7638be596f35f5f65fdd23051a557",
  "hard-coded-answer/files.txt": "91f16715ac24ecfc68e352f43494dd518abe38cb1801566be8e037094aaf2d41",
  "loosened-assertion/change.diff": "b5bf9f053fce501be319c3e3328e7e57a1e3815952ac091beb654c4c552290b9",
  "loosened-assertion/files.txt": "91f16715ac24ecfc68e352f43494dd518abe38cb1801566be8e037094aaf2d41",
  "replaced-test/change.diff": "11297c0c9c8db215d094941fadec53d4e2775fa2002d75643afbb64481c15249",
  "replaced-test/files.txt": "91f16715ac24ecfc68e352f43494dd518abe38cb1801566be8e037094aaf2d41",
};

/** Every file under fixtures/skylos-nine/, as a path relative to it with forward slashes, sorted. */
function filesOnDisk(): string[] {
  const dir = join(ROOT, DIR);
  return readdirSync(dir, { recursive: true })
    .map((entry) => String(entry).split("\\").join("/"))
    .filter((path) => statSync(join(dir, path)).isFile())
    .sort();
}

const sha256 = (path: string) =>
  createHash("sha256")
    .update(readFileSync(join(ROOT, DIR, path)))
    .digest("hex");

describe("the skylos-nine fixtures are pinned", () => {
  it("the files under fixtures/skylos-nine/ are exactly the pinned ones", () => {
    expect(
      filesOnDisk(),
      `a file was added to or removed from ${DIR}/: update PINS in this test deliberately, in the same change`,
    ).toEqual(Object.keys(PINS).sort());
  });

  it("every file under fixtures/skylos-nine/ matches its sha256 pin", () => {
    for (const [path, pin] of Object.entries(PINS)) {
      expect(
        sha256(path),
        `${DIR}/${path} changed: if the change is intended, update its pin in this test deliberately, in the same change`,
      ).toBe(pin);
    }
  });
});
