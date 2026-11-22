# Upload to pharn.dev (optional)

When the job grants `id-token: write` and the organization installed the Pharn GitHub App, the Action uploads the run
to pharn.dev, so the app can keep the history of runs and comment on the pull request itself. The `upload` input
(`auto` by default, or `never`) is in the [Action reference](action.md); it is read only from the workflow,
never from `.pharn/ci.yml`, so a pull request cannot turn it on or off.

**What is sent.** One gzip archive of two files, `report.json` and `meta.json`, and three requests: one `POST` to ask
the app for a signed storage URL, one `PUT` of the archive to that URL, and one `POST` to register the run. Only the OIDC
token (to the app, never to storage) and these two files leave the job. `report.json` is the report with every string
redacted by the [secret shapes](checks/secrets.md), every message and signal text cut to 2048 bytes, and the
test-integrity excerpts (`base` and `head`) dropped. `meta.json` is the run metadata ([`schema/upload-meta.v1.json`](../schema/upload-meta.v1.json)).
Never file contents, diffs, coverage files or logs. With [`junit-paths`](checks/flaky-tests.md) the archive
also holds `junit/results.xml`, a minimal JUnit document rebuilt from the parsed test cases (names, status, time, and
failure messages redacted and cut to 2048 bytes), never the runner's own file or its output; the org's
`settings.uploadJunit: false` leaves it out. The archive is limited to 5 MiB of `report.json`, 25 MiB of
`junit/results.xml` and the size the app names; a larger report is not uploaded and adds one `UPLOAD_TOO_LARGE`
warning (the check ran in full).

**What the job sees.** The signed URL and the token are masked and never logged. An upload that succeeds sets the
`run-url` output and logs one line without a URL. The App then comments on the pull request, so `pharn-ci` posts no
comment of its own; a comment an earlier run of the same workflow and job left is updated to one line that points to
the run on pharn.dev, so the pull request never shows that run's verdict beside the App's comment. The job summary
and `report.json` still carry the report. An upload fails open: whatever goes wrong (a timeout, a non-2xx answer, an
unexpected answer, an exception) ends in one warning that names a reason, never fails the check and never changes its
verdict, except that `UPLOAD_TOO_LARGE` can turn a pass into a warn. The whole upload ends within 90 s of its start:
each request and the `PUT` is cut off at the time left, and running out is one more failed upload (a reason ending
in `:deadline`).

**When nothing is uploaded.** With `upload: never`, without `id-token: write` (a fork pull request never gets it), when
the OIDC token request fails or times out, or on a `pull_request_target` run (its default checkout is the base branch,
which pharn-ci refuses to measure), nothing is sent and the report says `meta.upload.status: skipped`. A failed token
request is one info line in the job log and never a message or a verdict change: the upload never fails the check. A report without a `meta` block (no run metadata)
is never sent and carries no upload status. When the app answers the policy request or the upload with `404`
(the organization has not installed the Pharn GitHub App for the repository), the PR comment and the job summary
end with a one-line hint to install it, once, and nothing else changes.

What this does not cover is in [`docs/LIMITS.md`](LIMITS.md), and the trust boundaries are in
[`docs/THREAT-MODEL.md`](THREAT-MODEL.md). The app comments as `pharn[bot]`; the comment of the Action and the one
of the App never both appear for one upload.
