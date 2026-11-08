import type { JunitCase } from "../junit/parse.js";
import type { JunitResults } from "../junit/results.js";
import { MESSAGE_MAX_BYTES, redactMessage, redactSecrets, truncateUtf8 } from "../secrets/redact.js";

/** The largest `junit/results.xml` the Action offers for upload, in bytes of UTF-8 (25 MiB). */
export const UPLOAD_JUNIT_MAX_BYTES = 26_214_400;

/** The path of the normalised JUnit results inside the upload's archive. */
export const UPLOAD_JUNIT_NAME = "junit/results.xml";

/**
 * A code unit XML 1.0 cannot carry, even as a reference: the C0 controls but tab, line feed and carriage return, a lone
 * surrogate, and U+FFFE and U+FFFF.
 */
function isXmlForbidden(text: string, i: number): boolean {
  const code = text.charCodeAt(i);
  if (code < 0x20) return code !== 0x09 && code !== 0x0a && code !== 0x0d;
  if (code === 0xfffe || code === 0xffff) return true;
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = text.charCodeAt(i + 1);
    return !(next >= 0xdc00 && next <= 0xdfff);
  }
  if (code >= 0xdc00 && code <= 0xdfff) {
    const prev = text.charCodeAt(i - 1);
    return !(prev >= 0xd800 && prev <= 0xdbff);
  }
  return false;
}

/**
 * The text as an XML attribute value between double quotes: `&`, `<`, `>` and `"` as entities, tab, line feed and
 * carriage return as numeric references (so attribute normalisation keeps them), and every character XML cannot carry
 * as U+FFFD.
 */
export function xmlAttribute(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (isXmlForbidden(text, i)) out += "�";
    else if (char === "&") out += "&amp;";
    else if (char === "<") out += "&lt;";
    else if (char === ">") out += "&gt;";
    else if (char === '"') out += "&quot;";
    else if (char === "\t") out += "&#9;";
    else if (char === "\n") out += "&#10;";
    else if (char === "\r") out += "&#13;";
    else out += char;
  }
  return out;
}

/** A redacted text, cut to the longest an id, name or class name may be in the upload (4096 bytes). */
function redactedName(text: string): string {
  return truncateUtf8(redactSecrets(text), 4096);
}

function caseElement(testCase: JunitCase, cap: number): string {
  const time = testCase.time === null ? "" : ` time="${String(testCase.time)}"`;
  const head =
    `    <testcase id="${xmlAttribute(redactedName(testCase.id))}"` +
    ` classname="${xmlAttribute(redactedName(testCase.classname))}"` +
    ` name="${xmlAttribute(redactedName(testCase.name))}"${time}`;
  if (testCase.status === "passed") return `${head}/>`;
  if (testCase.status === "skipped") return `${head}>\n      <skipped/>\n    </testcase>`;
  const tag = testCase.status === "failed" ? "failure" : "error";
  const message =
    testCase.message === undefined ? "" : ` message="${xmlAttribute(redactMessage(testCase.message, cap))}"`;
  return `${head}>\n      <${tag}${message}/>\n    </testcase>`;
}

/**
 * The JUnit results as they leave the job: a minimal JUnit XML document rebuilt from the parsed test cases, never the
 * file the test runner wrote. A `<testsuite>` per run of consecutive cases of the same suite, in order; per case its
 * id (`junitTestId`, a pharn-ci attribute the app matches its quarantine list on), class name, name and time, and a
 * `<failure>`, `<error>` or `<skipped>` child for its status. A failure or error carries its message redacted and cut to
 * `messageMaxBytes` (never more than 2048); every other string is redacted and cut to 4096 bytes. No `system-out`, no
 * `system-err`, no properties, no stack trace beyond what the message holds. Throws a RangeError when `messageMaxBytes`
 * is not a safe integer of at least 32.
 */
export function buildJunitResultsXml(results: JunitResults, options?: { messageMaxBytes?: number }): string {
  const cap = Math.min(options?.messageMaxBytes ?? MESSAGE_MAX_BYTES, MESSAGE_MAX_BYTES);
  truncateUtf8("", cap);
  let failures = 0;
  let errors = 0;
  let skipped = 0;
  for (const testCase of results.cases) {
    if (testCase.status === "failed") failures++;
    else if (testCase.status === "error") errors++;
    else if (testCase.status === "skipped") skipped++;
  }
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${results.cases.length}" failures="${failures}" errors="${errors}" skipped="${skipped}">`,
  ];
  let suite: string | null = null;
  for (const testCase of results.cases) {
    if (testCase.suite !== suite) {
      if (suite !== null) lines.push("  </testsuite>");
      suite = testCase.suite;
      lines.push(`  <testsuite name="${xmlAttribute(redactedName(suite))}">`);
    }
    lines.push(caseElement(testCase, cap));
  }
  if (suite !== null) lines.push("  </testsuite>");
  lines.push("</testsuites>");
  return `${lines.join("\n")}\n`;
}
