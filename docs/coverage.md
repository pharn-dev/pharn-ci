# Coverage

How to get a coverage report pharn-ci can read from your test run, and how to make untested files count.

## Make untested files count

Diff coverage counts only the files your coverage report lists. With the default settings of vitest, jest and
pytest-cov, a new source file that no test imports is not in the report, so it does not lower diff coverage, even at
`threshold: 100`; pharn-ci only warns about it (`TESTS_NOT_EXERCISING_CHANGES`, for JavaScript, TypeScript and Python; Python files are skipped when the runner has
no usable `python3` for the Python test files the change touches; see [Test integrity](checks/test-integrity.md)). Tell
the runner which files are your source, and an untested file is listed at 0%:

| Runner     | Setting                                                         | Where                                   | Checked on                          |
| ---------- | --------------------------------------------------------------- | --------------------------------------- | ----------------------------------- |
| vitest     | `test: { coverage: { include: ["src/**/*.{ts,tsx}"] } }`        | `vitest.config.ts`                      | vitest 5.1.1                        |
| jest       | `collectCoverageFrom: ["src/**/*.{js,ts}"]`                     | `jest.config.js`, or `"jest"` in `package.json` | jest 30.5.2                 |
| pytest-cov | `source = ["mypackage"]` under `[tool.coverage.run]`            | `pyproject.toml`, or `.coveragerc`      | pytest-cov 7.1.0, coverage.py 7.17.3 |

Use the glob or package that holds your source. vitest 3 did this by default (`coverage.all: true`); vitest 4 removed
`coverage.all`, and only `coverage.include` brings unloaded files into the report. coverage.py finds unimported files
only in the source directory itself and in directories with an `__init__.py`. cargo-llvm-cov and coverlet need no
setting: every file compiled into the crate, or into an assembly the test project references, is in the report.

## Coverage per ecosystem

Point `coverage-file` at what your test run writes. Each of these tools produces a format pharn-ci
reads (`coverage-format: auto` detects lcov or Cobertura XML per file):

| Ecosystem       | Produce the report                                                         | `coverage-file`                                  |
| --------------- | -------------------------------------------------------------------------- | ------------------------------------------------ |
| vitest          | `npx vitest run --coverage --coverage.reporter=lcov` (needs `@vitest/coverage-v8`) | `coverage/lcov.info`                     |
| jest            | `npx jest --coverage --coverageReporters=lcov`                             | `coverage/lcov.info`                             |
| pytest-cov      | `pytest --cov --cov-report=xml` (Cobertura XML)                            | `coverage.xml`                                   |
| coverlet (.NET) | `dotnet test --collect:"XPlat Code Coverage"` (Cobertura XML)              | `TestResults/**/coverage.cobertura.xml`          |
| cargo-llvm-cov  | `cargo llvm-cov --lcov --output-path lcov.info`                            | `lcov.info`                                      |
| Go              | `go test -coverprofile=cover.out ./...`, then `gcov2lcov -infile cover.out -outfile lcov.info` | `lcov.info`                  |
| JaCoCo / Kover  | Convert the JaCoCo or Kover XML to Cobertura XML with a converter; the native XML is not read | the converted file                |

`coverage-file` takes one entry per line, each a path or a glob, relative to the workspace. All the
files are merged, and a line's hits are summed across them. A monorepo with a report per package:

```yaml
# the `with:` of the pharn-ci step
with:
  coverage-file: |
    packages/*/coverage/lcov.info
    tools/cli/coverage.xml
  threshold: 80
```

`coverage-root` applies to every file. If each package's report writes paths relative to that
package (`SF:src/index.ts`), have the test runner write absolute paths or paths from the repository
root instead; otherwise those paths match no tracked file and pharn-ci reports
`COVERAGE_PATHS_UNMATCHED` or `COVERAGE_PATHS_PARTIALLY_UNMATCHED`.
