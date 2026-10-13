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
  const root = normalizeRoot(repoRoot);
  if (root !== "" && startsWithPath(p, root)) {
    p = p.slice(root.length + 1);
  }
  return p;
}

/** `repoRoot` in the form `normalizePath` compares paths against, or "" when there is none. */
export function normalizeRoot(repoRoot?: string): string {
  if (!repoRoot) return "";
  const root = toPosix(repoRoot.trim());
  // Trailing slashes are stripped with a scan, not a regex, so hostile input stays linear.
  let end = root.length;
  while (end > 0 && root[end - 1] === "/") end--;
  return root.slice(0, end);
}

/**
 * `path` folded the way `startsWithPath` compares it with `root` (a `normalizeRoot` result): lower
 * case under a drive-letter root, unchanged otherwise.
 */
export function foldForRoot(path: string, root: string): string {
  return isDriveRoot(root) ? path.toLowerCase() : path;
}

/**
 * True when `path` is absolute under the rule `normalizePath` applies: after
 * backslashes become forward slashes it starts with `/` or with a drive letter
 * and `:/` (`C:\a`, `c:/a`). `C:a` and relative paths are not absolute.
 */
export function isAbsolutePath(path: string): boolean {
  const first = path.charAt(0);
  if (first === "/" || first === "\\") return true;
  const separator = path.charAt(2);
  return path.charAt(1) === ":" && (separator === "/" || separator === "\\") && isAsciiLetter(first);
}

/**
 * Join a coverage root in front of a path that is relative as written. With no root, or the repo root
 * (`.`), the path is returned unchanged. A `..` in `path` is resolved by the join; one that climbs above
 * the repo root stays a `..`-led relative path and matches no tracked file. Callers use this only on
 * paths that are not absolute.
 */
export function joinCoverageRoot(path: string, coverageRoot: string | undefined): string {
  if (coverageRoot === undefined || coverageRoot === ".") return path;
  return normalizePath(`${coverageRoot}/${path}`);
}

function isAsciiLetter(char: string): boolean {
  return (char >= "A" && char <= "Z") || (char >= "a" && char <= "z");
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

/**
 * True when the normalized `path` lies under `root` (a `normalizeRoot` result) on a whole-segment
 * match, the rule `normalizePath` strips the root by.
 */
export function startsWithPath(path: string, root: string): boolean {
  if (path.length <= root.length || path[root.length] !== "/") return false;
  const head = path.slice(0, root.length);
  // Windows drive paths are case-insensitive.
  return isDriveRoot(root) ? head.toLowerCase() === root.toLowerCase() : head === root;
}

function isDriveRoot(root: string): boolean {
  const first = root.charAt(0);
  return first >= "A" && first <= "Z" && root.charAt(1) === ":" && root.charAt(2) === "/";
}
