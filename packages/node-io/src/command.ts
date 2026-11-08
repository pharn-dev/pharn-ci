import { spawn } from "node:child_process";

/** How a command ended: its exit code, or the name of the signal that stopped it. */
export interface CommandEnd {
  code: number | null;
  signal: string | null;
}

/**
 * Runs `command` with `args` in `cwd` without a shell, so no argument is ever read as shell syntax, with this process's
 * stdin, stdout and stderr. Resolves how it ended; rejects when it cannot be started (for example, not found). Used by
 * `pharn-ci test`.
 */
export function runCommand(cwd: string, command: string, args: readonly string[]): Promise<CommandEnd> {
  return new Promise((done, fail) => {
    const child = spawn(command, [...args], { cwd, stdio: "inherit", shell: false });
    child.once("error", fail);
    child.once("close", (code, signal) => done({ code, signal }));
  });
}
