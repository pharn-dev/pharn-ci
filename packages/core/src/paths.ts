/**
 * Normalize a file path from a coverage report into a repo-relative POSIX path.
 *
 * - backslashes become forward slashes
 * - `.` segments, duplicate slashes and `..` segments are resolved
 * - if `repoRoot` is given and the path lies under it, the prefix is stripped
 *
 * Absolute paths outside `repoRoot` are returned normalized but still absolute,
 * so they simply won't match any diff path.
 */
export function normalizePath(path: string, repoRoot?: string): string {
  let p = toPosix(path.trim());
  if (repoRoot) {
    const root = toPosix(repoRoot.trim()).replace(/\/+$/, "");
    if (root !== "" && startsWithPath(p, root)) {
      p = p.slice(root.length + 1);
    }
  }
  return p;
}

function toPosix(path: string): string {
  const slashed = path.replace(/\\/g, "/");
  const drive = /^[A-Za-z]:\//.exec(slashed)?.[0] ?? "";
  const absolute = drive !== "" || slashed.startsWith("/");
  const rest = drive !== "" ? slashed.slice(drive.length) : slashed;

  const out: string[] = [];
  for (const segment of rest.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." && out.length > 0 && out[out.length - 1] !== "..") {
      out.pop();
    } else if (segment === ".." && absolute) {
      // `..` above the filesystem root stays at the root.
    } else {
      out.push(segment);
    }
  }
  const prefix = drive !== "" ? drive.toUpperCase() : absolute ? "/" : "";
  return prefix + out.join("/");
}

function startsWithPath(path: string, root: string): boolean {
  if (path.length <= root.length || path[root.length] !== "/") return false;
  const head = path.slice(0, root.length);
  // Windows drive paths are case-insensitive.
  return /^[A-Z]:\//.test(root) ? head.toLowerCase() === root.toLowerCase() : head === root;
}
