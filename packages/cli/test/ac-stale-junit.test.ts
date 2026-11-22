import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DirEntry } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";
import type { FileStamp } from "../../node-io/src/index.js";
import type { CliDeps } from "../src/main.js";
import { nodeDeps } from "../src/nodeDeps.js";
import { recordJunitFiles, runTestCommand, staleJunitFiles } from "../src/testCommand.js";
import { fixture } from "./fake-deps.js";

// CORE-121: `pharn-ci test` trusts only a JUnit file this run wrote. Before the command starts it records each matched
// file's modification time and sha256; after a non-zero exit, a matched file with both unchanged is stale, and then the
// command's own code is kept and stderr names the file. A fake file system and a fake `runCommand` stand in for disk and
// child process: each test says which files the command writes (new bytes, a new time, or both) and its exit code.

/** Every failed test of this file is on quarantine.json; failing.xml with quarantine-one.json is a mixed failure. */
const FAILING = fixture("junit/failing.xml");
const QUARANTINE = fixture("junit/quarantine.json");
const QUARANTINE_ONE = fixture("junit/quarantine-one.json");

interface FakeFile {
  text: string;
  mtimeNs: bigint;
}

interface Write {
  path: string;
  text: string;
  /** Leave the modification time as it was (a tool that keeps it); default: a new time. */
  keepTime?: boolean;
}

interface Fs extends CliDeps {
  files: Map<string, FakeFile>;
  err: string;
  ran: number;
}

const CWD = "/repo";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** A fake CLI whose file system is `files` (absolute paths) and whose command applies `writes`, then exits `exit`. */
function fakeFs(files: Record<string, string>, writes: Write[], exit: number): Fs {
  let clock = 1_000_000_000n;
  const tick = () => {
    clock += 1_000n;
    return clock;
  };
  const fs: Fs = {
    files: new Map(Object.entries(files).map(([path, text]) => [path, { text, mtimeNs: tick() }])),
    err: "",
    ran: 0,
    cwd: CWD,
    async git() {
      throw new Error("pharn-ci test never runs git");
    },
    async readFile(path) {
      return fs.files.get(path)?.text ?? null;
    },
    async listDir(path) {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const entries = new Map<string, DirEntry["kind"]>();
      for (const file of fs.files.keys()) {
        if (!file.startsWith(prefix)) continue;
        const [name, ...rest] = file.slice(prefix.length).split("/");
        if (name !== undefined) entries.set(name, rest.length > 0 ? "directory" : "file");
      }
      return entries.size === 0 ? null : [...entries].map(([name, kind]) => ({ name, kind }));
    },
    resolvePath: (...segments) =>
      segments.reduce((acc, s) => (s.startsWith("/") ? s : `${acc.replace(/\/$/, "")}/${s.replace(/^\.\//, "")}`), ""),
    async fileStamp(path, maxHashBytes): Promise<FileStamp | null> {
      const file = fs.files.get(path);
      if (file === undefined) return null;
      const size = Buffer.byteLength(file.text);
      return { mtimeNs: String(file.mtimeNs), size, sha256: size > maxHashBytes ? null : sha256(file.text) };
    },
    async runCommand() {
      fs.ran += 1;
      for (const write of writes) {
        const old = fs.files.get(write.path);
        const mtimeNs = write.keepTime === true && old !== undefined ? old.mtimeNs : tick();
        fs.files.set(write.path, { text: write.text, mtimeNs });
      }
      return { code: exit, signal: null };
    },
    stdout() {},
    stderr(text) {
      fs.err += text;
    },
  };
  return fs;
}

const QUARANTINE_FILE = { "/repo/quarantine.json": QUARANTINE };
const run = (fs: Fs, junit: string[] = ["out/*.xml"]) =>
  runTestCommand([...junit.flatMap((j) => ["--junit", j]), "--quarantine-file", "quarantine.json", "--", "npm"], fs);

describe("pharn-ci test: a JUnit file this run did not write cannot turn a failure into 0 (CORE-121)", () => {
  it("row 1: a stale file with only quarantined failures and a command that exits 1 without writing: exit 1, stderr names it", async () => {
    const fs = fakeFs({ ...QUARANTINE_FILE, "/repo/out/old.xml": FAILING }, [], 1);
    expect(await run(fs)).toBe(1);
    expect(fs.ran).toBe(1);
    expect(fs.err).toContain(
      "pharn-ci: stale JUnit file(s), unchanged since before the command ran, so this run did not write them: out/old.xml; pharn-ci keeps exit 1",
    );
    expect(fs.err).not.toContain("so pharn-ci exits 0");
  });

  it("row 2: a fresh file with only quarantined failures, command exits 1: exit 0, as today", async () => {
    const fs = fakeFs(QUARANTINE_FILE, [{ path: "/repo/out/new.xml", text: FAILING }], 1);
    expect(await run(fs)).toBe(0);
    expect(fs.err).toContain("the command exited 1 and every failed test is quarantined, so pharn-ci exits 0");
    expect(fs.err).not.toContain("stale");
  });

  it("row 2b: a file that was there before and that the command rewrote with other bytes is fresh", async () => {
    const fs = fakeFs(
      { ...QUARANTINE_FILE, "/repo/out/a.xml": "<testsuites/>" },
      [{ path: "/repo/out/a.xml", text: FAILING }],
      1,
    );
    expect(await run(fs)).toBe(0);
  });

  it("row 3: one fresh and one stale matched file: the command's exit code", async () => {
    const fs = fakeFs(
      { ...QUARANTINE_FILE, "/repo/out/b-old.xml": FAILING },
      [{ path: "/repo/out/a-new.xml", text: FAILING }],
      3,
    );
    expect(await run(fs)).toBe(3);
    expect(fs.err).toContain("so this run did not write them: out/b-old.xml; pharn-ci keeps exit 3");
    expect(fs.err).not.toContain("out/a-new.xml;");
  });

  it("row 4: a report rewritten with the same bytes (a reporter without timestamps) is fresh: only the time differs", async () => {
    const fs = fakeFs(
      { ...QUARANTINE_FILE, "/repo/out/same.xml": FAILING },
      [{ path: "/repo/out/same.xml", text: FAILING }],
      1,
    );
    expect(await run(fs)).toBe(0);
    expect(fs.err).not.toContain("stale");
  });

  it("row 4b: a report rewritten with other bytes and the old time (a tool that keeps it) is fresh: only the hash differs", async () => {
    const stale = FAILING.replace("timeout after 5000 ms", "timeout after 4000 ms");
    const fs = fakeFs(
      { ...QUARANTINE_FILE, "/repo/out/kept.xml": stale },
      [{ path: "/repo/out/kept.xml", text: FAILING, keepTime: true }],
      1,
    );
    expect(await run(fs)).toBe(0);
  });

  it("row 5: no matched file: the command's exit code, as today", async () => {
    const fs = fakeFs(QUARANTINE_FILE, [], 1);
    expect(await run(fs)).toBe(1);
    expect(fs.err).toContain("pharn-ci: JUNIT_NOT_FOUND:");
    expect(fs.err).not.toContain("stale");
  });

  it("row 6: a quarantined and an unrelated failure in a fresh file: non-zero, as today", async () => {
    const fs = fakeFs({ "/repo/quarantine.json": QUARANTINE_ONE }, [{ path: "/repo/out/mixed.xml", text: FAILING }], 1);
    expect(await run(fs)).toBe(1);
    expect(fs.err).toContain("2 failed (1 quarantined, 1 not quarantined)");
    expect(fs.err).not.toContain("stale");
  });

  it("row 7: a command that exits 0: exit 0, whatever the files are (stale, fresh, or none)", async () => {
    const stale = fakeFs({ ...QUARANTINE_FILE, "/repo/out/old.xml": FAILING }, [], 0);
    expect(await run(stale)).toBe(0);
    expect(stale.err).not.toContain("stale");
    const fresh = fakeFs(QUARANTINE_FILE, [{ path: "/repo/out/new.xml", text: FAILING }], 0);
    expect(await run(fresh)).toBe(0);
    expect(await run(fakeFs(QUARANTINE_FILE, [], 0))).toBe(0);
  });

  it("names at most 10 stale files on its one line, then counts the rest", async () => {
    const old = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`/repo/out/f${String(i).padStart(2, "0")}.xml`, FAILING]),
    );
    const fs = fakeFs({ ...QUARANTINE_FILE, ...old }, [], 1);
    expect(await run(fs)).toBe(1);
    const lines = fs.err.split("\n").filter((line) => line.includes("stale JUnit file(s)"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("out/f00.xml, out/f01.xml");
    expect(lines[0]).toContain("out/f09.xml, +2 more; pharn-ci keeps exit 1");
  });

  it("keeps the command's code when the files could not be recorded before the command ran", async () => {
    const fs = fakeFs(QUARANTINE_FILE, [{ path: "/repo/out/new.xml", text: FAILING }], 1);
    fs.fileStamp = async () => {
      throw new Error("EACCES");
    };
    // Nothing matched before the run, so nothing was stamped: the new file is fresh and the run exits 0.
    expect(await run(fs)).toBe(0);
    const blocked = fakeFs(
      { ...QUARANTINE_FILE, "/repo/out/old.xml": "<testsuites/>" },
      [{ path: "/repo/out/old.xml", text: FAILING }],
      1,
    );
    blocked.fileStamp = async () => {
      throw new Error("EACCES");
    };
    expect(await run(blocked)).toBe(1);
    expect(blocked.err).toContain(
      "pharn-ci: could not record the JUnit files before the command ran, so no file can be shown to be this run's; pharn-ci keeps exit 1",
    );
  });
});

describe("pharn-ci test with its real Node deps", { timeout: 60_000 }, () => {
  it("keeps exit 1 for a JUnit file left on disk, and exits 0 once the command rewrites the same bytes", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-stale-junit-")));
    try {
      const junitDir = fileURLToPath(new URL("../../../fixtures/junit/", import.meta.url));
      mkdirSync(join(dir, "out"));
      writeFileSync(join(dir, "out/old.xml"), FAILING);
      utimesSync(join(dir, "out/old.xml"), 1_700_000_000, 1_700_000_000);
      const deps = nodeDeps(dir);
      let err = "";
      deps.stderr = (text) => {
        err += text;
      };
      const command = join(junitDir, "command.mjs");
      const quarantine = ["--junit", "out/old.xml", "--quarantine-file", join(junitDir, "quarantine.json"), "--"];
      expect(await runTestCommand([...quarantine, process.execPath, command, "exit", "1"], deps)).toBe(1);
      expect(err).toContain("so this run did not write them: out/old.xml; pharn-ci keeps exit 1");
      const rewrite = [process.execPath, command, "junit", join(junitDir, "failing.xml"), "out/old.xml", "1"];
      expect(await runTestCommand([...quarantine, ...rewrite], deps)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("recordJunitFiles and staleJunitFiles", () => {
  it("hashes in match order within the 25 MiB budget and stamps a file past it by its time alone", async () => {
    const fs = fakeFs({ "/repo/out/a.xml": "aaaa", "/repo/out/b.xml": "bb" }, [], 1);
    const budgets: number[] = [];
    const stamp = fs.fileStamp?.bind(fs);
    fs.fileStamp = async (path, max) => {
      budgets.push(max);
      return stamp ? stamp(path, max) : null;
    };
    const before = await recordJunitFiles(fs, ["out/*.xml"]);
    expect([...(before?.keys() ?? [])]).toEqual(["out/a.xml", "out/b.xml"]);
    expect(budgets).toEqual([25 * 1024 * 1024, 25 * 1024 * 1024 - 4]);
    expect(before?.get("out/a.xml")?.sha256).toBe(sha256("aaaa"));
  });

  it("calls a file past the hash budget stale when its time is unchanged, fresh when its time changed", async () => {
    const fs = fakeFs({ "/repo/out/a.xml": "aaaa" }, [], 1);
    const old: FileStamp = { mtimeNs: String(fs.files.get("/repo/out/a.xml")?.mtimeNs), size: 4, sha256: null };
    expect(await staleJunitFiles(fs, new Map([["out/a.xml", old]]), ["out/a.xml"])).toEqual(["out/a.xml"]);
    expect(await staleJunitFiles(fs, new Map([["out/a.xml", { ...old, mtimeNs: "1" }]]), ["out/a.xml"])).toEqual([]);
    // Not there before: fresh. Gone now although it was read: not shown to be fresh, so stale.
    expect(await staleJunitFiles(fs, new Map(), ["out/a.xml"])).toEqual([]);
    expect(await staleJunitFiles(fs, new Map([["out/gone.xml", old]]), ["out/gone.xml"])).toEqual(["out/gone.xml"]);
  });
});
