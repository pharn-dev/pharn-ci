import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVendoredTypeScript } from "../src/vendored-typescript.js";

// The loader that stands in for `typescript5` in the Action's bundle, driven from source with a small CommonJS file.

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
/** Assigns `module.exports`, as the real typescript.js does, and has a function that overflows the stack. */
const MODULE = [
  "module.exports = {",
  '  name: "stand-in",',
  "  answer: 42,",
  "  recurse: function recurse() { return recurse() + 1; },",
  "  where: () => [typeof require, typeof __filename, typeof __dirname],",
  "};",
  "",
].join("\n");

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pharn-ci-vendored-ts-"));
  file = join(dir, "typescript.js");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Stub = { name: string; answer: number; recurse(): number; where(): string[] };
const read = (value: unknown) => value as Stub;

describe("createVendoredTypeScript", () => {
  it("reads nothing before the first property read, then loads once and hands the module to onLoad", () => {
    writeFileSync(file, MODULE);
    const onLoad = vi.fn();
    const { placeholder, failure } = createVendoredTypeScript(file, sha256(MODULE), onLoad);
    expect(onLoad).not.toHaveBeenCalled();
    expect(failure()).toBeUndefined();

    expect(read(placeholder).answer).toBe(42);
    expect(read(placeholder).name).toBe("stand-in");
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad.mock.calls[0]?.[0]).toMatchObject({ answer: 42 });
    expect(read(placeholder).where()).toEqual(["function", "string", "string"]);
    expect(failure()).toBeUndefined();
  });

  it("evaluates in the current context: a stack overflow in the module is this realm's RangeError", () => {
    writeFileSync(file, MODULE);
    const { placeholder } = createVendoredTypeScript(file, sha256(MODULE), () => {});
    let thrown: unknown;
    try {
      read(placeholder).recurse();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RangeError);
  });

  it("refuses a file whose sha256 differs from the pin, naming the path and both hashes, and evaluates nothing", () => {
    const flipped = MODULE.replace("42", "43");
    writeFileSync(file, flipped);
    const onLoad = vi.fn();
    const { placeholder, failure } = createVendoredTypeScript(file, sha256(MODULE), onLoad);
    expect(() => read(placeholder).answer).toThrow(file);
    expect(() => read(placeholder).answer).toThrow(sha256(flipped));
    expect(() => read(placeholder).answer).toThrow(sha256(MODULE));
    expect(onLoad).not.toHaveBeenCalled();
    expect(failure()).toContain(sha256(flipped));
    expect(failure()).toContain(sha256(MODULE));
    expect(failure()).toContain(file);
  });

  it("refuses a missing file, naming the path", () => {
    const { placeholder, failure } = createVendoredTypeScript(file, sha256(MODULE), () => {});
    expect(() => read(placeholder).answer).toThrow(/cannot read the vendored TypeScript parser/);
    expect(failure()).toContain(file);
  });

  it("refuses a file that matches the pin but throws when evaluated", () => {
    const broken = 'throw new Error("boom");\n';
    writeFileSync(file, broken);
    const { placeholder, failure } = createVendoredTypeScript(file, sha256(broken), () => {});
    expect(() => read(placeholder).answer).toThrow(/failed to load: boom/);
    expect(failure()).toMatch(/failed to load: boom/);
  });

  it("refuses a file that matches the pin but is not valid JavaScript", () => {
    const broken = "module.exports = ;\n";
    writeFileSync(file, broken);
    const { placeholder, failure } = createVendoredTypeScript(file, sha256(broken), () => {});
    expect(() => read(placeholder).answer).toThrow(/failed to load/);
    expect(failure()).toMatch(/failed to load/);
  });

  it("keeps a failure: every later read throws the same error and the file is not read again", () => {
    const { placeholder, failure } = createVendoredTypeScript(file, sha256(MODULE), () => {});
    let first: unknown;
    try {
      read(placeholder).answer;
    } catch (err) {
      first = err;
    }
    // The file now appears with the right bytes; a kept failure must not read it.
    writeFileSync(file, MODULE);
    let second: unknown;
    try {
      read(placeholder).name;
    } catch (err) {
      second = err;
    }
    expect(second).toBe(first);
    expect(failure()).toBe((first as Error).message);
  });

  it("keeps the failure when onLoad throws", () => {
    writeFileSync(file, MODULE);
    const { placeholder, failure } = createVendoredTypeScript(file, sha256(MODULE), () => {
      throw new Error("onLoad refused");
    });
    expect(() => read(placeholder).answer).toThrow("onLoad refused");
    expect(failure()).toBe("onLoad refused");
  });

  it("wraps a non-Error throw of onLoad in an Error", () => {
    writeFileSync(file, MODULE);
    const { placeholder, failure } = createVendoredTypeScript(file, sha256(MODULE), () => {
      throw "plain text";
    });
    expect(() => read(placeholder).answer).toThrow("plain text");
    expect(failure()).toBe("plain text");
  });
});
