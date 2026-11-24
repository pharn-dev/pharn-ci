// The Python source the test index runs, as two constants. Each is an untagged template literal with no substitution,
// no backtick and no backslash (the Python code writes line feeds with chr(10) and so on), so esbuild sees a pure
// constant and drops it from a bundle that does not import it.

/**
 * The first program, valid Python 2 and 3. It reports an interpreter older than 3.8 (exit code 3, one line on stderr)
 * and otherwise compiles and runs the main script, which arrives as the second command-line argument.
 */
export const PYTHON_BOOTSTRAP = `import sys
if sys.version_info < (3, 8):
    sys.stderr.write("pharn-ci-python-too-old " + ".".join([str(part) for part in sys.version_info[:3]]) + chr(10))
    sys.exit(3)
exec(compile(sys.argv[1], "<pharn-ci-python-index>", "exec"), {"__name__": "__pharn_ci__"})
`;

/**
 * The main script, Python 3.8 and later, standard library only (ast, json, sys, warnings). It reads
 * [{"id": n, "text": ...}] from stdin and writes one JSON array to stdout: per file either a refusal or the
 * normalized text with its test blocks and mock calls, and, when the file has any, the module names it imports
 * (`imports`, at most 1000) and the top-level import bindings into pytest or unittest whose local name differs from the
 * target (`aliases`, [local, target] pairs; TI03 resolves aliased skip spellings with them). A file with more than 1000
 * such bindings, or one whose name or target is longer than 500, is refused as too-large rather than cut. It only
 * parses (ast.parse); nothing in a file is run.
 */
export const PYTHON_INDEX_SCRIPT = `import ast
import json
import sys
import warnings

warnings.simplefilter("ignore")

LF = chr(10)
CR = chr(13)
BOM = chr(0xFEFF)

# The deepest syntax tree node the index walks, as core's MAX_TEST_INDEX_DEPTH for the TS index: the module is at
# depth 0 and every child one deeper. A deeper tree is refused as too-deep whether or not this Python's parser
# accepted it, so every version from 3.8 gives the same answer.
MAX_DEPTH = 1000

DECORATOR_MODIFIERS = {
    "pytest.mark.skip": "skip",
    "mark.skip": "skip",
    "unittest.skip": "skip",
    "skip": "skip",
    "pytest.mark.skipif": "skipIf",
    "unittest.skipIf": "skipIf",
    "skipIf": "skipIf",
    "unittest.skipUnless": "runIf",
    "skipUnless": "runIf",
    "pytest.mark.xfail": "fails",
    "unittest.expectedFailure": "fails",
    "expectedFailure": "fails",
    "pytest.mark.parametrize": "each",
}
FIXTURES = ("pytest.fixture", "fixture")
APPROX = ("pytest.approx", "approx")
BODY_CALLS = ("pytest.skip", "pytest.xfail")
# A raise of one of these in a test body skips the test (pytest reports unittest.SkipTest as a skip).
SKIP_EXCEPTIONS = ("unittest.SkipTest", "unittest.case.SkipTest")
# Called at module level, these skip the whole module: importorskip always, skip with allow_module_level=True.
MODULE_SKIPS = ("pytest.importorskip", "pytest.skip")
SKIP_MODIFIERS = ("skip", "skipIf", "runIf", "fails")
# The longest name and path entry the index writes, in characters, as core's MAX_TEST_NAME_CHARS.
MAX_NAME = 500
# The most distinct module names the index writes per file, as core's MAX_TEST_IMPORTS for the TS index's imports.
MAX_IMPORTS = 1000
CLASS_HOOKS = (
    "setup_method", "teardown_method", "setup_class", "teardown_class",
    "setUp", "tearDown", "setUpClass", "tearDownClass", "asyncSetUp", "asyncTearDown",
)
MODULE_HOOKS = ("setUpModule", "tearDownModule")
MOCK_CALLEES = (
    "patch", "mock.patch", "unittest.mock.patch", "mocker.patch",
    "patch.object", "mock.patch.object", "unittest.mock.patch.object", "mocker.patch.object",
    "monkeypatch.setattr",
)
RAISING_CALLEES = ("pytest.raises", "pytest.warns", "pytest.fail")
OPERATORS = {
    ast.Eq: "==", ast.NotEq: "!=", ast.Lt: "<", ast.LtE: "<=", ast.Gt: ">", ast.GtE: ">=",
    ast.Is: "is", ast.IsNot: "is not", ast.In: "in", ast.NotIn: "not in",
}

FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef)
TRIES = (ast.Try,) + ((ast.TryStar,) if getattr(ast, "TryStar", None) is not None else ())
CONDITIONALS = (ast.If, ast.IfExp, ast.While, ast.ExceptHandler, ast.BoolOp) + (
    (ast.Match,) if getattr(ast, "Match", None) is not None else ()
)
FSTRINGS = (ast.JoinedStr,) + ((ast.TemplateStr,) if getattr(ast, "TemplateStr", None) is not None else ())

# A walk context is a tuple: (block, scope, chain, fn, in_try, conditional, nested, in_fstring, in_if).
# scope: 0 module level, 1 directly in a test class, 2 anywhere else. in_if: inside an if statement since the module
# or the test class whose body holds the node.
BLOCK, SCOPE, CHAIN, FN, TRY, COND, NESTED, FSTR, IF = range(9)


def dotted(node):
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        parts.reverse()
        return ".".join(parts)
    return None


def is_string(node):
    return isinstance(node, ast.Constant) and isinstance(node.value, (str, bytes))


def import_aliases(tree):
    """Local name to dotted name for the module's top-level imports, in order; a later binding replaces an earlier one."""
    aliases = {}
    for node in tree.body:
        if isinstance(node, ast.Import):
            for item in node.names:
                if item.asname:
                    aliases[item.asname] = item.name
                else:
                    first = item.name.split(".")[0]
                    aliases[first] = first
        elif isinstance(node, ast.ImportFrom):
            for item in node.names:
                if item.name == "*":
                    continue
                if node.level > 0 or node.module is None:
                    target = "." + item.name
                else:
                    target = node.module + "." + item.name
                aliases[item.asname or item.name] = target
    return aliases


def in_skip_namespace(target):
    """Whether a dotted target is pytest or unittest, or a name under one of them: only these can resolve to a skip form."""
    for root in ("pytest", "unittest"):
        if target == root or target.startswith(root + "."):
            return True
    return False


def alias_pairs(aliases):
    """The import_aliases entries TI03 can use, as [local, target] pairs in the dict's order: the target is pytest or
    unittest or a name under one, and the local name differs from it (an identity binding such as import pytest adds
    nothing: TI03 tries the literal spelling first). None when more than MAX_IMPORTS such pairs remain or a kept name
    or target is longer than MAX_NAME UTF-16 code units: the caller refuses the file as too-large, so no binding is ever
    dropped silently (CORE-356)."""
    pairs = []
    for local, target in aliases.items():
        if local == target or not in_skip_namespace(target):
            continue
        if utf16_length(local) > MAX_NAME or utf16_length(target) > MAX_NAME or len(pairs) >= MAX_IMPORTS:
            return None
        pairs.append([local, target])
    return pairs


def module_imports(tree):
    """The module names of every import and from-import statement anywhere in the module (ast.walk order), each once,
    at most MAX_IMPORTS; a name longer than MAX_NAME UTF-16 code units is left out. import a.b gives a.b; from a.b
    import c gives a.b and a.b.c; a relative import keeps its dots (from . import c gives .c); a star adds nothing."""
    names = []
    seen = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found = [item.name for item in node.names]
        elif isinstance(node, ast.ImportFrom):
            prefix = "." * (node.level or 0)
            members = [item.name for item in node.names if item.name != "*"]
            if node.module:
                found = [prefix + node.module] + [prefix + node.module + "." + member for member in members]
            else:
                found = [prefix + member for member in members]
        else:
            continue
        for name in found:
            if name in seen or utf16_length(name) > MAX_NAME:
                continue
            if len(names) >= MAX_IMPORTS:
                return names
            seen.add(name)
            names.append(name)
    return names


def canonical(name, table, aliases):
    """The table's own name for a dotted name: as written when it is in the table, else with its first segment resolved."""
    if name is None:
        return None
    if name in table:
        return name
    head, dot, rest = name.partition(".")
    target = aliases.get(head)
    if target is None:
        return None
    resolved = target + dot + rest
    return resolved if resolved in table else None


def decorator_modifiers(decorators, aliases):
    mods = []
    for decorator in decorators:
        call = decorator if isinstance(decorator, ast.Call) else None
        name = canonical(dotted(call.func if call is not None else decorator), DECORATOR_MODIFIERS, aliases)
        mod = DECORATOR_MODIFIERS.get(name)
        if mod is None:
            continue
        mods.append(mod)
        if name == "pytest.mark.xfail" and call is not None:
            first = call.args[0] if call.args else None
            conditional = first is not None and not isinstance(first, ast.Starred) and not is_string(first)
            if conditional or any(keyword.arg == "condition" for keyword in call.keywords):
                mods.append("skipIf")
    return mods


def pytestmark_modifiers(body, aliases):
    """The skip modifiers of the last pytestmark assignment directly in a module or class body: one mark, or a list or
    tuple of marks, each read as a decorator is; [] when there is none."""
    value = None
    for node in body:
        if isinstance(node, ast.Assign):
            if any(isinstance(target, ast.Name) and target.id == "pytestmark" for target in node.targets):
                value = node.value
        elif isinstance(node, ast.AnnAssign):
            if isinstance(node.target, ast.Name) and node.target.id == "pytestmark" and node.value is not None:
                value = node.value
    if value is None:
        return []
    marks = list(value.elts) if isinstance(value, (ast.List, ast.Tuple)) else [value]
    return [mod for mod in decorator_modifiers(marks, aliases) if mod in SKIP_MODIFIERS]


def empty_table(decorators, aliases):
    """Whether a parametrize decorator gives an empty list or tuple literal as its argument values (pytest then runs
    no case of the test: it skips it by default)."""
    for decorator in decorators:
        if not isinstance(decorator, ast.Call):
            continue
        if canonical(dotted(decorator.func), DECORATOR_MODIFIERS, aliases) != "pytest.mark.parametrize":
            continue
        values = decorator.args[1] if len(decorator.args) > 1 else None
        for keyword in decorator.keywords:
            if keyword.arg == "argvalues":
                values = keyword.value
        if isinstance(values, (ast.List, ast.Tuple)) and not values.elts:
            return True
    return False


def is_false(node):
    return isinstance(node, ast.Constant) and not node.value


def removals(statements):
    """The defs and classes of one statement list that a later statement of the same list takes out of collection: a
    def or class of the same name (the name now binds the later one), a del of the name, or name.__test__ = a false
    constant. Maps id(node) to the line of the statement that takes it out."""
    removed = {}
    bound = {}
    for statement in statements:
        names = []
        if isinstance(statement, FUNCTIONS + (ast.ClassDef,)):
            names = [statement.name]
        elif isinstance(statement, ast.Delete):
            targets = list(statement.targets)
            while targets:
                target = targets.pop()
                if isinstance(target, (ast.Tuple, ast.List)):
                    targets.extend(target.elts)
                elif isinstance(target, ast.Name):
                    names.append(target.id)
        elif isinstance(statement, ast.Assign) and is_false(statement.value):
            for target in statement.targets:
                if isinstance(target, ast.Attribute) and target.attr == "__test__" and isinstance(target.value, ast.Name):
                    names.append(target.value.id)
        for name in names:
            node = bound.pop(name, None)
            if node is not None:
                removed[id(node)] = statement.lineno
        if isinstance(statement, FUNCTIONS + (ast.ClassDef,)):
            bound[statement.name] = statement
    return removed


def class_test_off(body):
    """The line of the last __test__ = ... assignment directly in a class body when it assigns a false constant."""
    line = None
    for statement in body:
        if isinstance(statement, ast.Assign):
            if any(isinstance(target, ast.Name) and target.id == "__test__" for target in statement.targets):
                line = statement.lineno if is_false(statement.value) else None
    return line


def allows_module_level(call):
    return any(
        keyword.arg == "allow_module_level" and isinstance(keyword.value, ast.Constant) and keyword.value.value
        for keyword in call.keywords
    )


def has_decorator(decorators, names, aliases):
    for decorator in decorators:
        name = dotted(decorator.func if isinstance(decorator, ast.Call) else decorator)
        if canonical(name, names, aliases) is not None:
            return True
    return False


def is_test_class(node):
    if node.name.startswith("Test"):
        return True
    for base in node.bases:
        name = dotted(base)
        if name is not None and name.split(".")[-1].endswith("TestCase"):
            return True
    return False


def block_kind(node, scope, aliases):
    """The block kind of a def at module level (scope 0) or in a test class (scope 1), else None."""
    name = node.name
    fixture = has_decorator(node.decorator_list, FIXTURES, aliases)
    if scope == 0:
        if fixture:
            return "hook"
        if name.startswith("test"):
            return "test"
        if name.startswith("setup_") or name.startswith("teardown_") or name in MODULE_HOOKS:
            return "hook"
        return None
    if fixture or name in CLASS_HOOKS:
        return "hook"
    if name.startswith("test"):
        return "test"
    return None


def assert_chain(test, aliases):
    if isinstance(test, ast.Compare):
        for operand in [test.left] + list(test.comparators):
            if isinstance(operand, ast.Call) and canonical(dotted(operand.func), APPROX, aliases) is not None:
                return "assert approx"
        if len(test.ops) == 1 and isinstance(test.ops[0], (ast.Is, ast.IsNot)):
            for operand in (test.left, test.comparators[0]):
                if isinstance(operand, ast.Constant) and operand.value is None:
                    return "assert is None" if isinstance(test.ops[0], ast.Is) else "assert is not None"
        return "assert " + " ".join([OPERATORS[type(op)] for op in test.ops])
    if isinstance(test, ast.Call) and isinstance(test.func, ast.Name) and test.func.id == "isinstance":
        return "assert isinstance"
    if isinstance(test, ast.UnaryOp) and isinstance(test.op, ast.Not):
        return "assert not"
    return "assert truthy"


def call_assertion(callee, node, aliases):
    raising = canonical(callee, RAISING_CALLEES, aliases)
    if raising is not None:
        return raising + "()"
    func = node.func
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) and func.value.id == "self":
        if func.attr.startswith("assert") or func.attr == "fail":
            return "self." + func.attr + "()"
    return None


def mock_specifier(callee, node):
    args = node.args
    first = args[0] if args else None
    if first is not None and isinstance(first, ast.Starred):
        first = None
    if callee.endswith(".object") or (callee == "monkeypatch.setattr" and not (
        isinstance(first, ast.Constant) and isinstance(first.value, str)
    )):
        target = dotted(first) if first is not None else None
        second = args[1] if len(args) > 1 else None
        if (
            target is not None
            and isinstance(second, ast.Constant)
            and isinstance(second.value, str)
        ):
            return target + "." + second.value
        return None
    if isinstance(first, ast.Constant) and isinstance(first.value, str):
        return first.value
    return None


class Source:
    """Line starts and the byte-to-character conversion of ast columns, built once per file."""

    def __init__(self, text):
        self.text = text
        self.lines = text.split(LF)
        self.starts = []
        position = 0
        for line in self.lines:
            self.starts.append(position)
            position += len(line) + 1
        self.tables = {}

    def offset(self, lineno, col):
        index = lineno - 1
        line = self.lines[index]
        if line.isascii():
            return self.starts[index] + col
        table = self.tables.get(index)
        if table is None:
            table = []
            for i, ch in enumerate(line):
                code = ord(ch)
                size = 1 if code < 0x80 else 2 if code < 0x800 else 3 if code < 0x10000 else 4
                table.extend([i] * size)
            table.append(len(line))
            self.tables[index] = table
        return self.starts[index] + table[col]

    def start(self, node):
        return self.offset(node.lineno, node.col_offset)

    def end(self, node):
        return self.offset(node.end_lineno, node.end_col_offset)

    def at_sign(self, decorator):
        """The offset of a decorator's at-sign, which the decorator expression does not include."""
        start = self.start(decorator)
        at = start
        while at > 0 and self.text[at - 1] in " " + chr(9):
            at -= 1
        return at - 1 if at > 0 and self.text[at - 1] == "@" else start


def utf16_length(piece):
    if piece.isascii():
        return len(piece)
    return len(piece.encode("utf-16-le", "surrogatepass")) // 2


WHITESPACE = str.maketrans({9: 32, 10: 32, 11: 32, 12: 32})


def code_piece(piece, after_space):
    """A stretch outside literals: comments become one space and runs of ASCII whitespace collapse to one."""
    if "#" in piece:
        parts = []
        position = 0
        while True:
            hash_at = piece.find("#", position)
            if hash_at < 0:
                parts.append(piece[position:])
                break
            parts.append(piece[position:hash_at])
            parts.append(" ")
            line_end = piece.find(LF, hash_at)
            if line_end < 0:
                break
            position = line_end
        piece = "".join(parts)
    piece = piece.translate(WHITESPACE)
    while "  " in piece:
        piece = piece.replace("  ", " ")
    if after_space and piece.startswith(" "):
        piece = piece[1:]
    return piece


def normalize(text, ranges, points):
    """The text with comments out and whitespace collapsed outside literals; also where each point lands in it."""
    pieces = []
    length = 0
    after_space = False
    where = {}
    ordered = sorted(set(points))
    next_point = 0
    cursor = 0
    regions = []
    previous_end = 0
    for start, end in sorted(ranges):
        if start < previous_end or end <= start:
            continue
        if start > previous_end:
            regions.append((previous_end, start, False))
        regions.append((start, end, True))
        previous_end = end
    if previous_end < len(text):
        regions.append((previous_end, len(text), False))
    for start, end, literal in regions:
        cursor = start
        while True:
            while next_point < len(ordered) and ordered[next_point] <= cursor:
                where[ordered[next_point]] = length
                next_point += 1
            stop = end
            if next_point < len(ordered) and ordered[next_point] < end:
                stop = ordered[next_point]
            if stop > cursor:
                piece = text[cursor:stop]
                if literal:
                    after_space = False
                else:
                    piece = code_piece(piece, after_space)
                    if piece:
                        after_space = piece.endswith(" ")
                pieces.append(piece)
                length += utf16_length(piece)
                cursor = stop
            if cursor >= end:
                break
    while next_point < len(ordered):
        where[ordered[next_point]] = length
        next_point += 1
    return "".join(pieces), where


def deeper_than_cap(tree):
    """Whether any node of the tree sits deeper than MAX_DEPTH. Iterative: an explicit stack, never recursion."""
    stack = [(tree, 0)]
    while stack:
        node, depth = stack.pop()
        if depth > MAX_DEPTH:
            return True
        for child in ast.iter_child_nodes(node):
            stack.append((child, depth + 1))
    return False


def build(text):
    text = text.replace(CR + LF, LF).replace(CR, LF)
    if text.startswith(BOM):
        text = text[1:]
    tree = ast.parse(text, "<pharn-ci-python-index>")
    if deeper_than_cap(tree):
        return {"parsed": False, "reason": "too-deep"}
    source = Source(text)
    aliases = import_aliases(tree)
    pairs = alias_pairs(aliases)
    if pairs is None:
        return {"parsed": False, "reason": "too-large"}
    module_marks = pytestmark_modifiers(tree.body, aliases)

    blocks = []
    mocks = []
    assertions = []
    ranges = []
    awaited = set()
    removed = {}
    module_skips = []
    stack = [(tree, (None, 0, (), None, False, False, False, False, False))]
    while stack:
        node, ctx = stack.pop()
        kind_of = type(node)

        if kind_of in FUNCTIONS:
            block = ctx[BLOCK]
            scope = ctx[SCOPE]
            kind = block_kind(node, scope, aliases) if scope < 2 else None
            record = [None]
            for field in ("decorator_list", "args", "returns", "type_params"):
                value = getattr(node, field, None)
                if isinstance(value, list):
                    stack.extend((child, ctx) for child in value)
                elif value is not None:
                    stack.append((value, ctx))
            if kind is not None:
                entry = new_block(
                    source,
                    node,
                    kind,
                    ctx[CHAIN] + (node.name[:MAX_NAME],),
                    decorator_modifiers(node.decorator_list, aliases),
                )
                switch_off(entry, ctx, removed.get(id(node)))
                entry["empty_table"] = empty_table(node.decorator_list, aliases)
                blocks.append(entry)
                inner = (entry, 2, ctx[CHAIN], record, False, False, False, ctx[FSTR], False)
            else:
                inner = (block, 2, ctx[CHAIN], record, ctx[TRY], ctx[COND], block is not None, ctx[FSTR], False)
            stack.extend((child, inner) for child in node.body)
            continue

        if kind_of is ast.ClassDef:
            scope = ctx[SCOPE]
            for field in ("decorator_list", "bases", "keywords", "type_params"):
                stack.extend((child, ctx) for child in getattr(node, field, ()))
            if scope < 2 and is_test_class(node):
                chain = ctx[CHAIN] + (node.name[:MAX_NAME],)
                mods = decorator_modifiers(node.decorator_list, aliases) + pytestmark_modifiers(node.body, aliases)
                entry = new_block(source, node, "describe", chain, mods)
                switch_off(entry, ctx, removed.get(id(node)) or class_test_off(node.body))
                entry["empty_table"] = empty_table(node.decorator_list, aliases)
                blocks.append(entry)
                removed.update(removals(node.body))
                inner = (entry, 1, chain, None, False, False, False, ctx[FSTR], False)
            else:
                block = ctx[BLOCK]
                inner = (block, 2, ctx[CHAIN], None, ctx[TRY], ctx[COND], block is not None, ctx[FSTR], False)
            stack.extend((child, inner) for child in node.body)
            continue

        if ctx[SCOPE] < 2:
            # Module or test-class code: a def or class of a statement list here may be taken out by a later statement.
            for value in ast.iter_fields(node):
                statements = value[1]
                if isinstance(statements, list) and statements and isinstance(statements[0], ast.stmt):
                    removed.update(removals(statements))

        if kind_of is ast.Lambda:
            stack.append((node.args, ctx))
            inner = ctx[:NESTED] + (True,) + ctx[NESTED + 1:]
            stack.append((node.body, inner))
            continue

        if kind_of in TRIES and node.handlers:
            inside = ctx[:TRY] + (True,) + ctx[TRY + 1:]
            for field, value in ast.iter_fields(node):
                if isinstance(value, list):
                    use = inside if field == "body" else ctx
                    stack.extend((child, use) for child in value if isinstance(child, ast.AST))
            continue

        child_ctx = ctx
        if kind_of in CONDITIONALS:
            child_ctx = ctx[:COND] + (True,) + ctx[COND + 1:]
            if kind_of is ast.If:
                child_ctx = child_ctx[:IF] + (True,)
        elif kind_of in FSTRINGS:
            if not ctx[FSTR]:
                ranges.append((source.start(node), source.end(node)))
            child_ctx = ctx[:FSTR] + (True,) + ctx[FSTR + 1:]
        elif kind_of is ast.Constant:
            if not ctx[FSTR] and isinstance(node.value, (str, bytes)):
                ranges.append((source.start(node), source.end(node)))
            continue
        elif kind_of is ast.Return:
            function = ctx[FN]
            if function is not None:
                end = (node.end_lineno, node.end_col_offset)
                if function[0] is None or end < function[0]:
                    function[0] = end
        elif kind_of is ast.Await:
            if isinstance(node.value, ast.Call):
                awaited.add(id(node.value))
        elif kind_of is ast.Assert:
            block = ctx[BLOCK]
            if block is not None:
                assertions.append((block, node.lineno, node.col_offset, assert_chain(node.test, aliases), False, ctx))
        elif kind_of is ast.Raise:
            block = ctx[BLOCK]
            if block is not None and block["kind"] != "describe" and not ctx[NESTED] and node.exc is not None:
                raised = node.exc.func if isinstance(node.exc, ast.Call) else node.exc
                if canonical(dotted(raised), SKIP_EXCEPTIONS, aliases) is not None:
                    block["mods"].append("skipIf" if ctx[COND] else "skip")
        elif kind_of is ast.Call:
            callee = dotted(node.func)
            block = ctx[BLOCK]
            if block is None and ctx[SCOPE] == 0 and not ctx[NESTED]:
                module_call = canonical(callee, MODULE_SKIPS, aliases)
                if module_call == "pytest.importorskip" or (module_call == "pytest.skip" and allows_module_level(node)):
                    module_skips.append(node.lineno)
            if callee in MOCK_CALLEES:
                mocks.append((node.lineno, node.col_offset, callee, mock_specifier(callee, node)))
            if block is not None and callee is not None:
                chain = call_assertion(callee, node, aliases)
                if chain is not None:
                    assertions.append((block, node.lineno, node.col_offset, chain, id(node) in awaited, ctx))
                elif block["kind"] != "describe" and not ctx[NESTED]:
                    body_call = canonical(callee, BODY_CALLS, aliases)
                    if body_call == "pytest.skip" or callee == "self.skipTest":
                        block["mods"].append("skipIf" if ctx[COND] else "skip")
                    elif body_call == "pytest.xfail":
                        block["mods"].append("fails")
                        if ctx[COND]:
                            block["mods"].append("skipIf")
        stack.extend((child, child_ctx) for child in ast.iter_child_nodes(node))

    if module_marks:
        for block in blocks:
            block["mods"].extend(module_marks)

    for block, line, col, chain, is_awaited, ctx in assertions:
        function = ctx[FN]
        early = function is not None and function[0] is not None and function[0] <= (line, col)
        block["assertions"].append((line, col, chain, is_awaited, ctx[TRY], early))

    blocks.sort(key=lambda b: (b["line"], b["col"]))
    mocks.sort(key=lambda m: (m[0], m[1]))
    if not blocks:
        normalized = ""
        where = {}
    else:
        points = []
        for block in blocks:
            points.append(block["body_start"])
            points.append(block["body_end"])
        normalized, where = normalize(text, ranges, points)
    module_skip = min(module_skips) if module_skips else None
    out_blocks = []
    for block in blocks:
        block["assertions"].sort(key=lambda a: (a[0], a[1]))
        out_blocks.append(switch_off_fields(block, module_skip, {
            "kind": block["kind"],
            "name": block["name"],
            "path": list(block["path"]),
            "line": block["line"],
            "endLine": block["end_line"],
            "modifiers": block["mods"],
            "bodyStart": where[block["body_start"]],
            "bodyEnd": where[block["body_end"]],
            "assertions": [
                {"chain": a[2], "line": a[0], "awaited": a[3], "inTryCatch": a[4], "afterEarlyReturn": a[5]}
                for a in block["assertions"]
            ],
        }))
    out = {
        "parsed": True,
        "normalized": normalized,
        "tests": out_blocks,
        "mocks": [{"callee": m[2], "specifier": m[3], "line": m[0]} for m in mocks],
    }
    imports = module_imports(tree)
    if imports:
        out["imports"] = imports
    if pairs:
        out["aliases"] = pairs
    return out


def switch_off(entry, ctx, removed_at):
    """Records on a new block whether it sits under an if, and the line of the statement that takes it out of
    collection (which makes it a skip)."""
    entry["guarded"] = ctx[IF]
    entry["removed_at"] = removed_at
    if removed_at is not None:
        entry["mods"].append("skip")


def switch_off_fields(block, module_skip, out):
    """The output block with the optional fields: written only when they hold, so a block without one is unchanged."""
    if block["guarded"]:
        out["guarded"] = "if"
    if block["empty_table"]:
        out["emptyTable"] = True
    if block["removed_at"] is not None:
        out["removedAt"] = block["removed_at"]
    if module_skip is not None:
        out["moduleSkip"] = module_skip
    return out


def new_block(source, node, kind, path, mods):
    first = node.body[0]
    last = node.body[-1]
    body_start = source.start(first)
    if isinstance(first, FUNCTIONS + (ast.ClassDef,)):
        for decorator in first.decorator_list:
            body_start = min(body_start, source.at_sign(decorator))
    body_end = source.end(last)
    return {
        "kind": kind,
        "name": node.name[:MAX_NAME],
        "path": path,
        "line": node.lineno,
        "col": node.col_offset,
        "end_line": node.end_lineno,
        "mods": mods,
        "body_start": body_start,
        "body_end": body_end,
        "assertions": [],
    }


def refusal(error):
    if isinstance(error, RecursionError):
        return "too-deep"
    if isinstance(error, SyntaxError):
        message = str(error)
        if "too many nested parentheses" in message or "too many levels of indentation" in message:
            return "too-deep"
        return "syntax-error"
    if isinstance(error, ValueError):
        return "syntax-error"
    if isinstance(error, MemoryError):
        return "too-deep" if "too complex" in str(error) else "too-large"
    return "parser-threw"


def index_file(text):
    try:
        return build(text)
    except BaseException as error:
        if isinstance(error, (KeyboardInterrupt, SystemExit)):
            raise
        return {"parsed": False, "reason": refusal(error)}


def main():
    items = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    out = []
    for item in items:
        result = index_file(item["text"])
        entry = {"id": item["id"]}
        entry.update(result)
        out.append(entry)
    data = json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode("utf-8", "replace")
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


main()
`;
