import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The skylos-nine fixtures are the benchmark the test-integrity signals are measured against (docs/PRECISION.md §3),
// so a silent edit to one would move the benchmark under the tests that read it. Every file under the three Skylos
// fixture folders is pinned here by sha256, and the set of files is pinned too. `fixtures/** -text` (.gitattributes)
// keeps the bytes the same on every checkout.
//
// When a fixture changes on purpose, update its pin here in the same change and add a one-line comment above the pin
// naming the commit and why, as for the two edits below (made before the pins existed).

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const PINS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "skylos-nine": {
    "added-skip/change.diff": "0cccf34c0c883f37819d93e2a5eb4195922fff8f06261afee8d03fe2943175c1",
    "added-skip/files.txt": "91f16715ac24ecfc68e352f43494dd518abe38cb1801566be8e037094aaf2d41",
    "always-true-matcher/change.diff": "34dd1da1c323622887812fa2fc02695ec937d069cd948ddd8a4d411cef21195d",
    "always-true-matcher/files.txt": "91f16715ac24ecfc68e352f43494dd518abe38cb1801566be8e037094aaf2d41",
    "deleted-test/change.diff": "40f9e1fa375ecc9d5614252c37c467896a9e7a36fd115921622f7eec5a85a051",
    "deleted-test/files.txt": "5993b94dd044f74db164a2332bf71e2cd8549cb94a9d954578b97de000685ee2",
    "deselect-setting/change.diff": "0e6f346c3f4325d66167c5d6e6cc36d166004959f549103ca7188f12dbd9d81c",
    "deselect-setting/files.txt": "91f16715ac24ecfc68e352f43494dd518abe38cb1801566be8e037094aaf2d41",
    // edited in b46f2f3 (#94, TI07): the source change that the new expected value matches was added, so the case shows what TI07 reads.
    "edited-expected-value/change.diff": "373c93d0996bac438f55d20f27941f4558d79d4bd9bc8e37967d8267e48ec15e",
    "edited-expected-value/files.txt": "91f16715ac24ecfc68e352f43494dd518abe38cb1801566be8e037094aaf2d41",
    "emptied-assertion/change.diff": "223706c5ef1e8b4302ca1e1a1c3c895e614ae945be844c9c91f10f16c78c145a",
    "emptied-assertion/files.txt": "91f16715ac24ecfc68e352f43494dd518abe38cb1801566be8e037094aaf2d41",
    "hard-coded-answer/change.diff": "5127e6334297e0c2f7f639ec1ca0f2a9edf7638be596f35f5f65fdd23051a557",
    "hard-coded-answer/files.txt": "91f16715ac24ecfc68e352f43494dd518abe38cb1801566be8e037094aaf2d41",
    "loosened-assertion/change.diff": "b5bf9f053fce501be319c3e3328e7e57a1e3815952ac091beb654c4c552290b9",
    "loosened-assertion/files.txt": "91f16715ac24ecfc68e352f43494dd518abe38cb1801566be8e037094aaf2d41",
    // edited in 98693cf (#91, TI02): the replacement test got a different body, so the case is a replacement, not a rename TI02 must excuse.
    "replaced-test/change.diff": "11297c0c9c8db215d094941fadec53d4e2775fa2002d75643afbb64481c15249",
    "replaced-test/files.txt": "91f16715ac24ecfc68e352f43494dd518abe38cb1801566be8e037094aaf2d41",
  },
  "skylos-nine-pytest": {
    "added-skip/base/tests/test_cart.py.txt": "66fa7fa2321ad07d8c25fb4b78eaf5226568be943a4cd0e932bf8892e189f2ac",
    "added-skip/change.diff": "f212087b48f27c47a0d3d13c37e0c2057ae36dcbfb3285adda147784cea3d273",
    "added-skip/files.txt": "bcb043e951f834fc832bc1e2d7e802caf962e6edbbdb6d1512f79722383a2f19",
    "added-skip/head/tests/test_cart.py.txt": "654979c05d6af046530848df83ba43717c52c4495eb61cf70ce44ea72a5d15b1",
    "added-skip-aliased/base/tests/test_cart.py.txt":
      "66fa7fa2321ad07d8c25fb4b78eaf5226568be943a4cd0e932bf8892e189f2ac",
    "added-skip-aliased/change.diff": "341332d384e01e3db86d1565415ad199409c0ffcfc10fd6f94dc7c1bf35a3c8b",
    "added-skip-aliased/files.txt": "bcb043e951f834fc832bc1e2d7e802caf962e6edbbdb6d1512f79722383a2f19",
    "added-skip-aliased/head/tests/test_cart.py.txt":
      "8589ad8323eb8c317e9194923491a65be4e9945e7d48951157c025d9a6a44188",
    "always-true-matcher/base/tests/test_cart.py.txt":
      "66fa7fa2321ad07d8c25fb4b78eaf5226568be943a4cd0e932bf8892e189f2ac",
    "always-true-matcher/change.diff": "9a78e64b989962753960c2aa3d4b5ec153e18519efeba7328ce315f8a5f6f1ff",
    "always-true-matcher/files.txt": "bcb043e951f834fc832bc1e2d7e802caf962e6edbbdb6d1512f79722383a2f19",
    "always-true-matcher/head/tests/test_cart.py.txt":
      "75bae08cf9c589442af01fa369a353a45b7f325ac739ef44b81947cc7f83fee5",
    "always-true-matcher-any/base/tests/test_cart.py.txt":
      "66fa7fa2321ad07d8c25fb4b78eaf5226568be943a4cd0e932bf8892e189f2ac",
    "always-true-matcher-any/change.diff": "687c71a018becc158a8288da36b7254c35954f84f9b0d359553cb2f72a93bafd",
    "always-true-matcher-any/files.txt": "bcb043e951f834fc832bc1e2d7e802caf962e6edbbdb6d1512f79722383a2f19",
    "always-true-matcher-any/head/tests/test_cart.py.txt":
      "e34da4a24970edac481a15c95d0ca835040b12c25d86ca8e4b056e8399bee9de",
    "deleted-test/base/tests/test_cart.py.txt": "66fa7fa2321ad07d8c25fb4b78eaf5226568be943a4cd0e932bf8892e189f2ac",
    "deleted-test/change.diff": "cc6417c5ba76ab2fe51a88625a000cca172ed798b2ea9d9ac1b122b88dc43e25",
    "deleted-test/files.txt": "9be869e3513afe2c0626c04396831473cac8f0a242122382b2bb9c439ec7e3d9",
    "deselect-setting/base/pyproject.toml.txt": "e57d5b84796a934c181354786d4e7469c8d1960f6bffd8ce4d176da219707f84",
    "deselect-setting/change.diff": "be3d603ffaceee886a05e6e46d9fc620e8fa57d0f5993eee8734af797f323918",
    "deselect-setting/files.txt": "bcb043e951f834fc832bc1e2d7e802caf962e6edbbdb6d1512f79722383a2f19",
    "deselect-setting/head/pyproject.toml.txt": "a3d2877138f73794a2a025d86afa6a3b5e621bf74e189c29d60f7b084323c7bb",
    "edited-expected-value/base/tests/test_cart.py.txt":
      "66fa7fa2321ad07d8c25fb4b78eaf5226568be943a4cd0e932bf8892e189f2ac",
    "edited-expected-value/change.diff": "c8bd38a58f04afa88e5b694d77b442431eda696c069113d815bd82b9c9ed0ef3",
    "edited-expected-value/files.txt": "bcb043e951f834fc832bc1e2d7e802caf962e6edbbdb6d1512f79722383a2f19",
    "edited-expected-value/head/tests/test_cart.py.txt":
      "63dd813633546e691842f16116f418ed86eeb0f890261dd572b3c491f4d5e4d5",
    "emptied-assertion/base/tests/test_cart.py.txt": "66fa7fa2321ad07d8c25fb4b78eaf5226568be943a4cd0e932bf8892e189f2ac",
    "emptied-assertion/change.diff": "fd6ca63d816bfa9ed5f2d9d905b2419cace4041da888965956da470159bd7234",
    "emptied-assertion/files.txt": "bcb043e951f834fc832bc1e2d7e802caf962e6edbbdb6d1512f79722383a2f19",
    "emptied-assertion/head/tests/test_cart.py.txt": "11be5081ad21fc9bb37f4e7ab85297ae817163edf4f705696405bf6a0d8aa9e0",
    "hard-coded-answer/change.diff": "9b2aa1e313263fb715dbdaec609a0ae6935564edd71fee23ce66f6ca129cd8a9",
    "hard-coded-answer/files.txt": "bcb043e951f834fc832bc1e2d7e802caf962e6edbbdb6d1512f79722383a2f19",
    "loosened-assertion/base/tests/test_cart.py.txt":
      "66fa7fa2321ad07d8c25fb4b78eaf5226568be943a4cd0e932bf8892e189f2ac",
    "loosened-assertion/change.diff": "8ed105a36242045f8565d3a923f19176625375d4ed1c22d8e2a7324eaa53cb22",
    "loosened-assertion/files.txt": "bcb043e951f834fc832bc1e2d7e802caf962e6edbbdb6d1512f79722383a2f19",
    "loosened-assertion/head/tests/test_cart.py.txt":
      "b0573f7a3e6bb8d4625f7c786f3adffea41df705ff30337ffb6a9e574b060fdf",
    "replaced-test/base/tests/test_cart.py.txt": "66fa7fa2321ad07d8c25fb4b78eaf5226568be943a4cd0e932bf8892e189f2ac",
    "replaced-test/change.diff": "9dfbe0c1685f880845032d5efdd4cb8891892b646cfcddf81e21e4ef22a41956",
    "replaced-test/files.txt": "bcb043e951f834fc832bc1e2d7e802caf962e6edbbdb6d1512f79722383a2f19",
    "replaced-test/head/tests/test_cart.py.txt": "484d47066533b71a162b224ea9a662f0e76a517550c46076d73a53b2c1fe9b5a",
  },
  "skylos-nine-sources": {
    "deselect-setting/base/vitest.config.ts.txt": "f7b586a422f3f36b69adaf976772e35ca6780a6eadc96cb7e88fbce6d3b76723",
    "deselect-setting/head/vitest.config.ts.txt": "7ab253117c3f37435dabf7269bd2887abc25fd4b9181728faa12d1e60e9e2fb2",
    "edited-expected-value/base/src/cart.test.ts.txt":
      "374f915eafbbb4e57360e6ed3900959117e0e7ae678ed003abdf8c4047fa5bda",
    "edited-expected-value/head/src/cart.test.ts.txt":
      "55b23f7eb240f34efa44bda1cb6fe59d74c8391c29c13303544f9a0f33bf4d2d",
    "emptied-assertion/base/src/cart.test.ts.txt": "374f915eafbbb4e57360e6ed3900959117e0e7ae678ed003abdf8c4047fa5bda",
    "emptied-assertion/head/src/cart.test.ts.txt": "c8996ed27b5841cd446fcb360e3d1a6c238321ca1a0f712864505e3cfb0e5373",
    "loosened-assertion/base/src/cart.test.ts.txt": "374f915eafbbb4e57360e6ed3900959117e0e7ae678ed003abdf8c4047fa5bda",
    "loosened-assertion/head/src/cart.test.ts.txt": "6199d832471e1de1ccbd7171c837dc3ce935f4d97fdc8174b6ea282486ff7c61",
    "replaced-test/base/src/cart.test.ts.txt": "374f915eafbbb4e57360e6ed3900959117e0e7ae678ed003abdf8c4047fa5bda",
    "replaced-test/head/src/cart.test.ts.txt": "edc97d1d1f4370fd007045379a738e838fdf41f6791298e9d74fdeb5d50a191e",
  },
};

/** Every file under fixtures/<dir>/, as a path relative to it with forward slashes, sorted. */
function filesOnDisk(dir: string): string[] {
  const base = join(ROOT, "fixtures", dir);
  return readdirSync(base, { recursive: true })
    .map((entry) => String(entry).split("\\").join("/"))
    .filter((path) => statSync(join(base, path)).isFile())
    .sort();
}

const sha256 = (dir: string, path: string) =>
  createHash("sha256")
    .update(readFileSync(join(ROOT, "fixtures", dir, path)))
    .digest("hex");

describe("the skylos-nine fixtures are pinned", () => {
  for (const [dir, pins] of Object.entries(PINS)) {
    it(`the files under fixtures/${dir}/ are exactly the pinned ones`, () => {
      expect(
        filesOnDisk(dir),
        `a file was added to or removed from fixtures/${dir}/: update PINS in this test deliberately, in the same change`,
      ).toEqual(Object.keys(pins).sort());
    });

    it(`every file under fixtures/${dir}/ matches its sha256 pin`, () => {
      for (const [path, pin] of Object.entries(pins)) {
        expect(
          sha256(dir, path),
          `fixtures/${dir}/${path} changed: if intended, update its pin here in the same change and say why above it`,
        ).toBe(pin);
      }
    });
  }
});
