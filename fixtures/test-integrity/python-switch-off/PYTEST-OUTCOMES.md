# What pytest does with each switch-off form (CORE-53)

**These outcomes come from pytest's documentation (and, where a section says so, from the Python language reference);
they were not run in this PR.** pytest was not installed on the machine that made this change, and nothing was
downloaded to run it. Each row names the documentation section the outcome is taken from. The pytest documentation is
at <https://docs.pytest.org/en/stable/>; the Python language reference at <https://docs.python.org/3/reference/>.

pytest collects a test module by importing it and then looking at the names the module (or a test class) defines: a
function or method whose name starts with `test`, inside a class whose name starts with `Test` (pytest documentation,
"Good Integration Practices", section "Conventions for Python test discovery"). A name that no longer binds the test
function when the import ends is not collected.

| # | Form (the case under this directory) | What pytest does | Where the outcome comes from |
| --- | --- | --- | --- |
| 1 | A test `def` under an `if` (`warn-if-guard`) | Collected and run where the condition holds at import; not collected where it does not (the `def` never runs, so the name is never bound) | pytest: "Conventions for Python test discovery"; Python reference: "The `if` statement" (8.1) and "Function definitions" (8.7) |
| 2 | A later `def` with the same name (`block-duplicate-def`) | The earlier test is not collected: the later `def` rebinds the name, so only the last one is in the module when collection looks | pytest: "Conventions for Python test discovery"; Python reference: "Function definitions" (8.7), a `def` binds the function name in the current namespace |
| 3 | `del test_x` (`block-del-test`) | Not collected: the name is removed from the module before collection looks | pytest: "Conventions for Python test discovery"; Python reference: "The `del` statement" (7.5) |
| 4 | `test_x.__test__ = False` (`block-test-attr-false`) | Not collected | pytest: "Changing standard (Python) test discovery", section "Customizing test collection" documents `__test__ = False` for a class; for a function, pytest's own collection hook (`pytest_pycollect_makeitem` in `_pytest/python.py`) makes no test item from a function whose `__test__` is false — that part is from pytest's source, not a documentation page |
| 5 | `@pytest.mark.parametrize("c", [])` (`block-parametrize-empty`) | Skipped (the default); with the ini option `empty_parameter_set_mark = xfail` it is an xfail, with `fail_at_collect` a collection error. It never runs as a passing test | pytest: "API Reference", configuration option `empty_parameter_set_mark` (its default, `skip`, skips a test with an empty parameter set); "How to parametrize fixtures and test functions" |
| 6 | Module-level `pytest.importorskip("numpy")` (`warn-importorskip`) | Every test of the module is skipped where the import fails; collected and run where it succeeds | pytest: "How to use skip and xfail to deal with tests that cannot succeed", section "Skipping on a missing import dependency"; "API Reference", `pytest.importorskip` |
| 7 | Module-level `pytest.skip("…", allow_module_level=True)` (`warn-skip-module-level`) | Every test of the module is skipped where that line runs (here, under `if sys.platform == "win32":`) | pytest: "How to use skip and xfail to deal with tests that cannot succeed", section "Skipping test functions" (calling `pytest.skip(reason, allow_module_level=True)` at module level skips the whole module); "API Reference", `pytest.skip` |
| 8 | `raise unittest.SkipTest("…")` in a test body (`block-raise-skiptest`) | Skipped: pytest reports a raised `unittest.SkipTest` as a skip | pytest: "How to use `unittest`-based tests with pytest" lists unittest skips among the supported features; for a plain test function, pytest's unittest plugin (`pytest_runtest_makereport` in `_pytest/unittest.py`) turns a raised `unittest.SkipTest` into a skip — that part is from pytest's source, not a documentation page |

No form is dropped: according to these sources pytest runs none of the eight as a normal passing test where the form
takes effect. Forms 1, 6 and 7 depend on a condition at import (the `if`, the import, the condition around the skip),
which is why the index reports form 1 as a conditional skip and forms 6 and 7 at `warn` only.

The must-not-trigger cases (`pass-if-guard-unchanged`, `pass-importorskip-at-base`, `pass-parametrize-non-empty`,
`pass-two-names`) hold a form that is already at the merge base, or no switch-off at all: a non-empty parametrize list
runs one case per value, and two defs with different names are two collected tests.
