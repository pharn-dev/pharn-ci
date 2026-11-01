import type { JsonMember, JsonValue } from "./json.js";

export interface McpServerRead {
  name: string;
  /** The line of the server's key. */
  line: number;
  command: string | null;
  args: string[] | null;
  url: string | null;
  isObject: boolean;
}

/** A value of the wrong type: `container` (the servers object, or a server that is not an object) or `field`. */
export interface McpWrongType {
  line: number;
  scope: "container" | "field";
}

/** The server containers of an MCP file: `mcpServers`, and for `.vscode/mcp.json` `servers` first. */
function containerKeys(path: string): string[] {
  return /(?:^|\/)\.vscode\/mcp\.json$/.test(path) ? ["servers", "mcpServers"] : ["mcpServers"];
}

/**
 * The servers an MCP file declares. Only `command` (a string), `args` (an array of strings) and `url` (a string) of a
 * server are read; never `env`, `headers` or anything else. A wrong-typed piece is reported and treated as absent.
 */
export function mcpServersOf(path: string, root: JsonValue): { servers: McpServerRead[]; wrongType: McpWrongType[] } {
  const servers: McpServerRead[] = [];
  const wrongType: McpWrongType[] = [];
  if (root.type !== "object") return { servers, wrongType };
  for (const key of containerKeys(path)) {
    const container: JsonMember | undefined = root.members.get(key);
    if (container === undefined) continue;
    if (container.value.type !== "object") {
      wrongType.push({ line: container.keyLine, scope: "container" });
      continue;
    }
    for (const [name, member] of container.value.members) {
      const server: McpServerRead = {
        name,
        line: member.keyLine,
        command: null,
        args: null,
        url: null,
        isObject: false,
      };
      servers.push(server);
      if (member.value.type !== "object") {
        wrongType.push({ line: member.keyLine, scope: "container" });
        continue;
      }
      server.isObject = true;
      const fields = member.value.members;
      const command = fields.get("command");
      if (command !== undefined) {
        if (command.value.type === "string") server.command = command.value.value;
        else wrongType.push({ line: command.keyLine, scope: "field" });
      }
      const url = fields.get("url");
      if (url !== undefined) {
        if (url.value.type === "string") server.url = url.value.value;
        else wrongType.push({ line: url.keyLine, scope: "field" });
      }
      const args = fields.get("args");
      if (args !== undefined) {
        if (args.value.type !== "array") wrongType.push({ line: args.keyLine, scope: "field" });
        else {
          const kept: string[] = [];
          for (const item of args.value.items) {
            if (item.type === "string") kept.push(item.value);
            else wrongType.push({ line: item.line, scope: "field" });
          }
          server.args = kept;
        }
      }
    }
  }
  return { servers, wrongType };
}

/**
 * Whole-string glob, case-sensitive: `*` is any run of characters (`/` and spaces included, possibly empty), `?` is
 * exactly one, everything else is literal. Iterative two-pointer match with backtracking to the last `*`; never a
 * RegExp built from input.
 */
export function mcpGlobMatches(entry: string, text: string): boolean {
  const e = Array.from(entry);
  const t = Array.from(text);
  let i = 0;
  let j = 0;
  let star = -1;
  let mark = 0;
  while (j < t.length) {
    if (i < e.length && e[i] === "*") {
      star = i;
      mark = j;
      i += 1;
    } else if (i < e.length && (e[i] === "?" || e[i] === t[j])) {
      i += 1;
      j += 1;
    } else if (star !== -1) {
      i = star + 1;
      mark += 1;
      j = mark;
    } else return false;
  }
  while (i < e.length && e[i] === "*") i += 1;
  return i === e.length;
}
