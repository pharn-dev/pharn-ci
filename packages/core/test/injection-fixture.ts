import { parseUnifiedDiff } from "../src/diff/unified.js";
import { keepInjectionText } from "../src/injection/scan.js";
import { keepSignalFileText } from "../src/signals/signalFiles.js";
import { fixture } from "./helpers.js";

// The prompt-injection fixtures (fixtures/injection/*.txt) are unified diffs stored as `.txt`, so this repository's own
// run of pharn-ci never reads them as instruction files, and under fixtures/, which the scan exempts. Invisible
// characters are written as `\u{XXXX}` escapes, so the fixtures carry no invisible character a reviewer cannot see;
// `injectionFixture` turns each escape into the character before a test reads the diff.

const ESCAPE = /\\u\{([0-9A-Fa-f]{1,6})\}/g;

/** The text with every `\u{XXXX}` escape replaced by its code point. */
export function decodeEscapes(text: string): string {
  return text.replace(ESCAPE, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

/** A fixture of fixtures/injection/, its escapes decoded. */
export function injectionFixture(name: string): string {
  return decodeEscapes(fixture(`injection/${name}`));
}

/** A diff text parsed the way check() parses one: signal text kept, and the added text the content scan reads. */
export function parseForInjection(text: string) {
  return parseUnifiedDiff(text, { keepText: keepSignalFileText(), keepAddedText: keepInjectionText });
}

/** A `--unified=0` diff that adds `lines` to a new file at `path`. */
export function addedFileDiff(path: string, lines: readonly string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    "",
  ].join("\n");
}
