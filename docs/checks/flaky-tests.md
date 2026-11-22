# Flaky tests and JUnit results

pharn-ci reads the JUnit XML your test step writes, reports what failed in a **🧫 Flaky** section, and applies the
organization's quarantine list from pharn.dev. It never fails a check because a test failed: the test step does that.
What it adds is a view of which failures are known to be flaky, and, with an upload, the results for the app's history.

```yaml
      - run: npm test -- --reporters=default --reporters=jest-junit   # writes junit.xml
      - name: pharn-ci            # the pharn-ci step of the Quick start, with:
        if: ${{ !cancelled() }}   # also after a failed test step
        with:
          junit-paths: junit.xml
```

**What is read.** The `junit-paths` input (CLI: `--junit`, repeatable) takes paths or globs (`*`, `**`, `?`) relative to
the workspace, separated by newlines or commas. A path outside the workspace (`..`, a leading `/`) fails the step; a
symbolic link is never followed. At most 50 files, 25 MiB and 20,000 test cases are read in one run; the rest is left
out with a `JUNIT_TOO_LARGE` warning. The reader is hand-written and linear in its input: `<testsuites>`, `<testsuite>`
(nested too) and `<testcase>` with a `<failure>`, `<error>` or `<skipped>` child. Entities are the five XML ones and
numeric references only; a file with a DOCTYPE or any other `<!` declaration is refused whole, so no entity is ever
expanded. A refused file (`doctype`, `malformed`, `not-junit`, `too-deep`) is a `JUNIT_INVALID` warning; no file at all
is `JUNIT_NOT_FOUND`. `<system-out>` and `<system-err>` are never kept.

**Test id.** A test is named `<classname>::<name>`. The class name falls back to the `file` attribute, then to the
name of the enclosing `<testsuite>`; when all three are empty the id is the name alone. Whitespace and control
characters are collapsed to one space. An id longer than 500 UTF-16 code units is cut to 491 and ends in `~` and the 8
hex digits of the 32-bit FNV-1a hash of the whole id. The app's quarantine list holds ids in this form.

**Quarantine.** With an app policy, the policy response's `quarantine` list is applied unless the policy sets
`flaky.quarantine: false`: a failed test on the list counts in `flaky.quarantinedFailures` and is listed in the
section, any other in `flaky.unquarantinedFailures`, and one `FLAKY_QUARANTINED_FAILURES` info message gives the
counts. Only the app's own answer carries the list; a pull request cannot add one, and no input or `.pharn/ci.yml` key
names one. The report's `flaky` object holds the counts and up to 200 quarantined ids that failed.

**Upload.** When the run is [uploaded](../upload.md), the archive also holds `junit/results.xml`: a
minimal JUnit document pharn-ci rebuilds from what it read (suite, class name, name, id, time, status, and for a failure
its message redacted and cut to 2 KB), never the file itself, never `system-out` or `system-err`. The org's
`settings.uploadJunit: false` keeps it out; then, and without an upload, `flaky.uploaded` is `false`.
`junit-include-output` is not shipped.

**`pharn-ci test`.** The CLI can wrap the test command, so a failure that only quarantined tests caused does not fail
the job:

```bash
pharn-ci test --junit 'reports/*.xml' --quarantine-file quarantine.json -- npx vitest run
```

It runs the command without a shell (each argument is passed as it is), with the terminal's input and output, then reads
the JUnit files and prints a short summary on stderr. It exits `0` when the command failed and the results show at
least one failed test, every failed test on the `--quarantine-file` list (a JSON array of ids), every matched file
read whole, and every matched file written by this run; otherwise it exits with the command's own code (`128 + n` when
signal `n` stopped it).

Only a JUnit file this run wrote counts. Before the command starts, `pharn-ci test` records the modification time and
the sha256 of every file the `--junit` patterns match. After a non-zero exit, a matched file whose time and bytes are
both unchanged is stale: an earlier run, a cache or a commit left it, so it cannot turn the failure into `0`. Then the
command's own code is kept and one stderr line names the stale files (up to 10, then a count). A file that was not there
before is fresh, and so is one the run rewrote: with the same bytes and a new time (a reporter without timestamps) or
with new bytes and the old time (a tool that keeps it). When the files cannot be recorded before the run (the glob walk
hits its limit, or a file cannot be read), no file can be shown to be fresh and the command's code is kept too. A
command that exits `0` exits `0` whatever the files are.

A quarantined failure does not hide an unrelated one: a fresh file with one failed test on the list and one that is
not still exits with the command's code. `--dry-run` prints
what would run and be read without running anything. It never makes a network call. A quarantine file the pull request
can edit lets the pull request quarantine its own failures, so keep it where the pull request cannot change it
([`docs/THREAT-MODEL.md`](../THREAT-MODEL.md), residual 42). What the reader misses is in
[`docs/LIMITS.md`](../LIMITS.md#flaky-tests-and-junit-results).
