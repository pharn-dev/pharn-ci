import { scanXml, type XmlEvent } from "../coverage/xml.js";
import { junitTestId } from "./testId.js";

/**
 * A JUnit XML reader for untrusted text, on the hand-written XML scanner of the Cobertura reader (`coverage/xml.ts`):
 * one forward pass, `indexOf` and per-character checks, no regular expression, so the cost is linear in the length of
 * the text. Entities are the five predefined ones and numeric references only; a document with any `<!` declaration
 * (DOCTYPE, ENTITY) is refused whole, so no entity is ever defined or expanded.
 *
 * Read: `<testsuites>` and `<testsuite>` (nested suites too) and their `<testcase>` elements, with a `<failure>`,
 * `<error>` or `<skipped>` child. Everything else (`<properties>`, `<system-out>`, `<system-err>`, Surefire's
 * `<flakyFailure>` and `<rerunFailure>`, unknown elements) is skipped, and the text of `<system-out>` and
 * `<system-err>` is never kept.
 */

/** How a test case ended: no child, `<failure>`, `<error>` or `<skipped>` (an error beats a failure, both beat a skip). */
export type JunitStatus = "passed" | "failed" | "error" | "skipped";

/** One `<testcase>` as read. `message` is set for a failure or an error only. */
export interface JunitCase {
  /** See `junitTestId`. */
  id: string;
  /** The name of the innermost enclosing `<testsuite>`, or "" outside any. */
  suite: string;
  /** The `classname` attribute, else the `file` attribute, else "". */
  classname: string;
  name: string;
  /** The `time` attribute in seconds, when it is a finite number of at least 0; else null. */
  time: number | null;
  status: JunitStatus;
  /**
   * For a failure or an error: its `message` attribute, else its text, cut to 8192 UTF-16 code units as it is read. Not
   * redacted here: the upload redacts it and cuts it to its byte budget, and the report never carries it.
   */
  message?: string;
}

/** Why a file was not used: a `<!` declaration, broken nesting, no JUnit root element, or nesting deeper than 256. */
export type JunitInvalidReason = "doctype" | "malformed" | "not-junit" | "too-deep";

export type JunitParse =
  | {
      ok: true;
      /** The test cases read, in document order, at most `maxCases`. */
      cases: JunitCase[];
      /** How many test cases the `maxCases` budget left out. */
      dropped: number;
    }
  | { ok: false; reason: JunitInvalidReason };

/** The most elements open at once. */
export const JUNIT_MAX_DEPTH = 256;
/** The longest failure or error message kept while reading, in UTF-16 code units. */
export const JUNIT_MESSAGE_READ_UNITS = 8192;

const STATUS_RANK: Readonly<Record<JunitStatus, number>> = { passed: 0, skipped: 1, failed: 2, error: 3 };

/** The `time` attribute as seconds: a finite number of at least 0 written in at most 32 characters, else null. */
function readTime(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > 32) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

interface OpenCase {
  suite: string;
  classname: string;
  file: string;
  name: string;
  time: number | null;
  status: JunitStatus;
  message: string | undefined;
  /** The stack depth of the `<failure>` or `<error>` whose text is being collected, or -1. */
  collectDepth: number;
  text: string;
}

/**
 * The test cases of one JUnit XML document, at most `maxCases` of them (the rest are counted in `dropped`), or why the
 * document is not used. Every element must be closed by an end tag of the same name; a document whose first element is
 * neither `<testsuites>` nor `<testsuite>`, or that has a second root element, is `not-junit` or `malformed`.
 */
export function parseJunitXml(text: string, maxCases: number): JunitParse {
  const stack: string[] = [];
  const suites: string[] = [];
  const cases: JunitCase[] = [];
  let dropped = 0;
  let declaration = false;
  let failure: JunitInvalidReason | null = null;
  let rootSeen = false;
  let rootClosed = false;
  let open: OpenCase | null = null;

  const closeCase = (current: OpenCase): void => {
    if (cases.length >= maxCases) {
      dropped++;
      return;
    }
    const message =
      current.status === "failed" || current.status === "error"
        ? (current.message ?? (current.text === "" ? undefined : current.text))
        : undefined;
    cases.push({
      id: junitTestId(current),
      suite: current.suite,
      classname: current.classname !== "" ? current.classname : current.file,
      name: current.name,
      time: current.time,
      status: current.status,
      ...(message === undefined ? {} : { message }),
    });
  };

  const onStart = (event: Extract<XmlEvent, { type: "start" }>): void => {
    if (!rootSeen) {
      if (event.name !== "testsuites" && event.name !== "testsuite") {
        failure = "not-junit";
        return;
      }
      rootSeen = true;
    } else if (rootClosed) {
      failure = "malformed";
      return;
    }
    const { name, attrs } = event;
    if (name === "testsuite" && open === null) suites.push(attrs.get("name") ?? "");
    if (name === "testcase" && open === null) {
      open = {
        suite: suites.length === 0 ? "" : (suites[suites.length - 1] as string),
        classname: attrs.get("classname") ?? "",
        file: attrs.get("file") ?? "",
        name: attrs.get("name") ?? "",
        time: readTime(attrs.get("time")),
        status: "passed",
        message: undefined,
        collectDepth: -1,
        text: "",
      };
      if (event.selfClosing) {
        closeCase(open);
        open = null;
        if (stack.length === 0) rootClosed = true;
        return;
      }
      if (stack.length >= JUNIT_MAX_DEPTH) {
        failure = "too-deep";
        return;
      }
      stack.push(name);
      return;
    }
    if (open !== null && open.collectDepth === -1) {
      const status: JunitStatus | null =
        name === "failure" ? "failed" : name === "error" ? "error" : name === "skipped" ? "skipped" : null;
      // Only a direct child of the test case counts.
      if (status !== null && stack[stack.length - 1] === "testcase") {
        if (STATUS_RANK[status] > STATUS_RANK[open.status]) {
          open.status = status;
          if (status !== "skipped") {
            const message = attrs.get("message");
            open.message = message === undefined ? undefined : message.slice(0, JUNIT_MESSAGE_READ_UNITS);
            open.text = "";
            if (!event.selfClosing) open.collectDepth = stack.length + 1;
          }
        }
      }
    }
    if (event.selfClosing) {
      if (name === "testsuite" && open === null) suites.pop();
      if (stack.length === 0) rootClosed = true;
      return;
    }
    if (stack.length >= JUNIT_MAX_DEPTH) {
      failure = "too-deep";
      return;
    }
    stack.push(name);
  };

  const onEnd = (name: string): void => {
    if (stack.length === 0 || stack[stack.length - 1] !== name) {
      failure = "malformed";
      return;
    }
    if (open !== null && open.collectDepth === stack.length) open.collectDepth = -1;
    stack.pop();
    if (name === "testcase" && open !== null && !stack.includes("testcase")) {
      closeCase(open);
      open = null;
    } else if (name === "testsuite" && open === null) {
      suites.pop();
    }
    if (stack.length === 0) rootClosed = true;
  };

  scanXml(
    text,
    (event) => {
      if (failure !== null || declaration) return;
      if (event.type === "start") onStart(event);
      else if (event.type === "end") onEnd(event.name);
      else if (open !== null && open.collectDepth !== -1 && open.text.length < JUNIT_MESSAGE_READ_UNITS) {
        open.text = (open.text + event.text).slice(0, JUNIT_MESSAGE_READ_UNITS);
      }
    },
    {
      cdataText: true,
      onDeclaration: () => {
        declaration = true;
      },
    },
  );
  if (declaration) return { ok: false, reason: "doctype" };
  if (failure !== null) return { ok: false, reason: failure };
  if (!rootSeen) return { ok: false, reason: "not-junit" };
  if (stack.length > 0) return { ok: false, reason: "malformed" };
  return { ok: true, cases, dropped };
}
