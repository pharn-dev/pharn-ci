import type { JsonValue } from "./json.js";

const PLAIN_LIST = /^[A-Za-z0-9_]+(\|[A-Za-z0-9_]+)*$/;

const isUniversal = (matcher: string | undefined): boolean =>
  matcher === undefined || matcher === "" || matcher === "*";

/**
 * Does a hook group's matcher cover the required one? No regex is ever evaluated. A universal group (omitted, empty or
 * `*`) covers every required matcher; a universal required matcher (every tool) is covered only by a universal group;
 * two plain `A|B` lists compare as sets (every required name is a group name); any other text, which Claude Code reads
 * as a regex, is covered only by the identical string.
 */
export function matcherCovers(group: string | undefined, required: string | undefined): boolean {
  if (isUniversal(group)) return true;
  if (isUniversal(required)) return false;
  const g = group as string;
  const r = required as string;
  if (PLAIN_LIST.test(g) && PLAIN_LIST.test(r)) {
    const names = new Set(g.split("|"));
    return r.split("|").every((name) => names.has(name));
  }
  return g === r;
}

/**
 * Does a handler count toward a required hook: a `command` handler with a non-empty command and no `if` key. `http`,
 * `mcp_tool`, `prompt` and `agent` handlers never count (the last two are model-evaluated).
 */
export function isCountingHandler(value: JsonValue): boolean {
  if (value.type !== "object") return false;
  const type = value.members.get("type")?.value;
  const command = value.members.get("command")?.value;
  return (
    type?.type === "string" &&
    type.value === "command" &&
    command?.type === "string" &&
    command.value !== "" &&
    !value.members.has("if")
  );
}
