// v0.9.0 fix hints (H6). Every message and every finding of Report v2 gains an optional `fix` object, so report.v2.json
// gains `$defs.fix` and six `fix` properties, and every report this repo pins gains a `fix` on each message and finding.
// The pins that compare report.v2.json with an older commit take exactly these insertions out first
// (`withoutV090SchemaEdits`, then the earlier helpers as before), and the pins that compare a whole report, or a golden
// report.json, with a value pinned at an older commit compute it over `withoutFix(...)` or `withoutFixJson(...)`.

/** The `fix` property of `$defs.message`, as the exact bytes report.v2.json gains after the `text` property. */
export const V090_MESSAGE_FIX_TEXT = `,
        "fix": {
          "description": "How to fix this message (since 0.9.0): one kind and one fixed sentence for its code; no kind lowers a gate. See $defs/fix.",
          "$ref": "#/$defs/fix"
        }`;

/** `$defs.fix`, as the exact bytes report.v2.json gains after `$defs.message`. */
export const V090_FIX_DEF_TEXT = `,
    "fix": {
      "description": "How to fix this message or finding honestly (since 0.9.0): one kind from a closed list and one fixed English sentence per code or signal id, never written by a model. No kind lowers a gate: none lowers a threshold, adds an exclusion, turns a test off, adds an exemption or edits a policy.",
      "type": "object",
      "additionalProperties": false,
      "required": ["kind", "hint"],
      "properties": {
        "kind": {
          "description": "What the fix asks for. add-test: add tests that run the changed code. restore-test: restore a test that was deleted, removed or turned off. restore-assertion: restore the assertions or expected values a test had. revert-config: revert the change to a config, script, workflow or settings file. remove-dependency: remove the dependency the change adds. request-review: a person should look at the change and confirm it, which an agent cannot decide. split-pr: split the change into smaller pull requests. none: no code change fixes this; the hint says what to check.",
          "enum": [
            "add-test",
            "restore-test",
            "restore-assertion",
            "revert-config",
            "remove-dependency",
            "request-review",
            "split-pr",
            "none"
          ]
        },
        "target": {
          "description": "The path, or path:line, the finding already names; never present on a message, never file text.",
          "type": "string"
        },
        "hint": {
          "description": "One fixed sentence for the code or signal id, at most 200 characters; never file text, diff text, a test name, a package name or a secret.",
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        }
      }
    }`;

/** The `fix` property of `testIntegrity.signals` items, as the exact bytes report.v2.json gains after `head`. */
export const V090_TEST_INTEGRITY_FIX_TEXT = `,
              "fix": {
                "description": "How to fix this test-integrity signal (since 0.9.0): one kind and one fixed sentence for its id, and its path or path:line as target; no kind lowers a gate. See $defs/fix.",
                "$ref": "#/$defs/fix"
              }`;

/** The `fix` property of `policy.violations` items, after `detail`. */
export const V090_POLICY_FIX_TEXT = `,
              "fix": {
                "description": "How to fix this policy violation (since 0.9.0): one kind and one fixed sentence for its rule id, and its path or path:line as target when it names a file; no kind lowers a gate. See $defs/fix.",
                "$ref": "#/$defs/fix"
              }`;

/** The `fix` property of `setupHealth.stale` items, after `token`. */
export const V090_STALE_FIX_TEXT = `,
              "fix": {
                "description": "How to fix this stale-instruction finding (since 0.9.0): one kind and one fixed sentence for its id, and path:line as target; no kind lowers a gate. See $defs/fix.",
                "$ref": "#/$defs/fix"
              }`;

/** The `fix` property of `injection.signals` items, after `detail`. */
export const V090_INJECTION_FIX_TEXT = `,
              "fix": {
                "description": "How to fix this prompt-injection signal (since 0.9.0): one kind and one fixed sentence for its id, and its path or path:line as target; no kind lowers a gate. See $defs/fix.",
                "$ref": "#/$defs/fix"
              }`;

/** The `fix` property of `dependencies.signals` items, after `detail`. */
export const V090_DEPENDENCY_FIX_TEXT = `,
              "fix": {
                "description": "How to fix this dependency signal (since 0.9.0): one kind and one fixed sentence for its id, and its path or path:line as target; no kind lowers a gate. See $defs/fix.",
                "$ref": "#/$defs/fix"
              }`;

/** Every v0.9.0 insertion into report.v2.json, in the order of the file. */
export const V090_SCHEMA_TEXTS = [
  V090_MESSAGE_FIX_TEXT,
  V090_FIX_DEF_TEXT,
  V090_TEST_INTEGRITY_FIX_TEXT,
  V090_POLICY_FIX_TEXT,
  V090_STALE_FIX_TEXT,
  V090_INJECTION_FIX_TEXT,
  V090_DEPENDENCY_FIX_TEXT,
];

/** `text` with `part` taken out; throws unless it appears exactly once. */
function withoutOnce(text: string, part: string, name: string): string {
  const count = text.split(part).length - 1;
  if (count !== 1) throw new Error(`v0.9.0: expected the ${name} once, found ${count}`);
  return text.replace(part, "");
}

/** report.v2.json with every v0.9.0 insertion (`$defs.fix` and the six `fix` properties) taken out; throws unless each appears once. */
export function withoutV090SchemaEdits(text: string): string {
  let out = text;
  V090_SCHEMA_TEXTS.forEach((part, i) => {
    out = withoutOnce(out, part, `fix schema insertion ${i + 1}`);
  });
  return out;
}

/**
 * A deep copy of `value` with every own `fix` property removed whose value is an object with a string `kind` and a
 * string `hint` (the report has no other `fix` key). The input is not changed.
 */
export function withoutFix<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => withoutFix(item)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "fix" && isFixObject(item)) continue;
      out[key] = withoutFix(item);
    }
    return out as T;
  }
  return value;
}

function isFixObject(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.kind === "string" && typeof record.hint === "string";
}

/** A report.json text with its `fix` objects taken out, written the way the goldens are written. */
export function withoutFixJson(text: string): string {
  return `${JSON.stringify(withoutFix(JSON.parse(text) as unknown), null, 2)}\n`;
}
