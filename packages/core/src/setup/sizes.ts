/**
 * The tracked symbolic links of `git ls-tree -r -l -z --full-tree HEAD` output: the paths whose mode field is exactly
 * `120000`. Records are parsed as `parseLsTreeSizes` parses them (four space-separated meta fields, the path verbatim
 * after the first TAB); an empty path or a malformed record is skipped. The input is untrusted, so this never throws.
 */
export function parseLsTreeSymlinks(text: string): Set<string> {
  const links = new Set<string>();
  for (const record of text.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    if (tab === -1) continue;
    const path = record.slice(tab + 1);
    if (path === "") continue;
    const meta = record
      .slice(0, tab)
      .split(" ")
      .filter((field) => field !== "");
    if (meta.length !== 4) continue;
    if (meta[0] === "120000") links.add(path);
  }
  return links;
}

/**
 * Parse `git ls-tree -r -l -z --full-tree HEAD` output into a map from repo-relative path to size in bytes.
 *
 * Each NUL-terminated record is `<mode> <type> <object> <size>\t<path>`, with the size space-padded. With `-z` git
 * does not quote the path, so it is taken verbatim. Only blobs with a numeric size are kept: a submodule entry
 * (`commit`, size `-`), a record without a TAB, an empty path, a wrong field count or a size that is not plain
 * digits is skipped. The input is untrusted (paths come from the PR), so this never throws.
 */
export function parseLsTreeSizes(text: string): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const record of text.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    if (tab === -1) continue;
    const path = record.slice(tab + 1);
    if (path === "") continue;
    const meta = record
      .slice(0, tab)
      .split(" ")
      .filter((field) => field !== "");
    if (meta.length !== 4) continue;
    const [, type, , sizeText] = meta;
    if (type !== "blob" || sizeText === undefined || !/^[0-9]+$/.test(sizeText)) continue;
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size)) continue;
    sizes.set(path, size);
  }
  return sizes;
}
