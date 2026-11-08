// A tiny stand-in for a test command, run by the pharn-ci test wrapper's tests with process.execPath.
//   node command.mjs exit <code>            exits with <code>
//   node command.mjs junit <src> <dest> <code>  copies the JUnit file <src> to <dest>, then exits with <code>
//   node command.mjs signal <name>          stops itself with the signal <name>
//   node command.mjs args <dest> ...        writes its other arguments as JSON to <dest>, then exits 0
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [mode, ...rest] = process.argv.slice(2);
if (mode === "exit") {
  process.exit(Number(rest[0]));
} else if (mode === "junit") {
  const [src, dest, code] = rest;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  process.exit(Number(code));
} else if (mode === "signal") {
  process.kill(process.pid, rest[0]);
  setTimeout(() => process.exit(99), 5000);
} else if (mode === "args") {
  const [dest, ...args] = rest;
  writeFileSync(dest, JSON.stringify(args));
  process.exit(0);
} else {
  process.exit(64);
}
