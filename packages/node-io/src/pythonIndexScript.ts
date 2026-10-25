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
 * normalized text with its test blocks and mock calls. It only parses (ast.parse); nothing in a file is run.
 */
export const PYTHON_INDEX_SCRIPT = `import ast
import json
import sys
import warnings

warnings.simplefilter("ignore")

LF = chr(10)
CR = chr(13)
BOM = chr(0xFEFF)

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

# A walk context is a tuple: (block, scope, chain, fn, in_try, conditional, nested, in_fstring).
# scope: 0 module level, 1 directly in a test class, 2 anywhere else.
BLOCK, SCOPE, CHAIN, FN, TRY, COND, NESTED, FSTR = range(8)


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


def decorator_modifiers(decorators):
    mods = []
    for decorator in decorators:
        call = decorator if isinstance(decorator, ast.Call) else None
        name = dotted(call.func if call is not None else decorator)
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


def has_decorator(decorators, names):
    for decorator in decorators:
        if dotted(decorator.func if isinstance(decorator, ast.Call) else decorator) in names:
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


def block_kind(node, scope):
    """The block kind of a def at module level (scope 0) or in a test class (scope 1), else None."""
    name = node.name
    fixture = has_decorator(node.decorator_list, FIXTURES)
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


def assert_chain(test):
    if isinstance(test, ast.Compare):
        for operand in [test.left] + list(test.comparators):
            if isinstance(operand, ast.Call) and dotted(operand.func) in ("pytest.approx", "approx"):
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


def call_assertion(callee, node):
    if callee in RAISING_CALLEES:
        return callee + "()"
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


def build(text):
    text = text.replace(CR + LF, LF).replace(CR, LF)
    if text.startswith(BOM):
        text = text[1:]
    tree = ast.parse(text, "<pharn-ci-python-index>")
    source = Source(text)

    blocks = []
    mocks = []
    assertions = []
    ranges = []
    awaited = set()
    stack = [(tree, (None, 0, (), None, False, False, False, False))]
    while stack:
        node, ctx = stack.pop()
        kind_of = type(node)

        if kind_of in FUNCTIONS:
            block = ctx[BLOCK]
            scope = ctx[SCOPE]
            kind = block_kind(node, scope) if scope < 2 else None
            record = [None]
            for field in ("decorator_list", "args", "returns", "type_params"):
                value = getattr(node, field, None)
                if isinstance(value, list):
                    stack.extend((child, ctx) for child in value)
                elif value is not None:
                    stack.append((value, ctx))
            if kind is not None:
                entry = new_block(source, node, kind, ctx[CHAIN] + (node.name,), decorator_modifiers(node.decorator_list))
                blocks.append(entry)
                inner = (entry, 2, ctx[CHAIN], record, False, False, False, ctx[FSTR])
            else:
                inner = (block, 2, ctx[CHAIN], record, ctx[TRY], ctx[COND], block is not None, ctx[FSTR])
            stack.extend((child, inner) for child in node.body)
            continue

        if kind_of is ast.ClassDef:
            scope = ctx[SCOPE]
            for field in ("decorator_list", "bases", "keywords", "type_params"):
                stack.extend((child, ctx) for child in getattr(node, field, ()))
            if scope < 2 and is_test_class(node):
                chain = ctx[CHAIN] + (node.name,)
                entry = new_block(source, node, "describe", chain, decorator_modifiers(node.decorator_list))
                blocks.append(entry)
                inner = (entry, 1, chain, None, False, False, False, ctx[FSTR])
            else:
                block = ctx[BLOCK]
                inner = (block, 2, ctx[CHAIN], None, ctx[TRY], ctx[COND], block is not None, ctx[FSTR])
            stack.extend((child, inner) for child in node.body)
            continue

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
                assertions.append((block, node.lineno, node.col_offset, assert_chain(node.test), False, ctx))
        elif kind_of is ast.Call:
            callee = dotted(node.func)
            block = ctx[BLOCK]
            if callee in MOCK_CALLEES:
                mocks.append((node.lineno, node.col_offset, callee, mock_specifier(callee, node)))
            if block is not None and callee is not None:
                chain = call_assertion(callee, node)
                if chain is not None:
                    assertions.append((block, node.lineno, node.col_offset, chain, id(node) in awaited, ctx))
                elif block["kind"] != "describe" and not ctx[NESTED]:
                    if callee in ("pytest.skip", "self.skipTest"):
                        block["mods"].append("skipIf" if ctx[COND] else "skip")
                    elif callee == "pytest.xfail":
                        block["mods"].append("fails")
                        if ctx[COND]:
                            block["mods"].append("skipIf")
        stack.extend((child, child_ctx) for child in ast.iter_child_nodes(node))

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
    out_blocks = []
    for block in blocks:
        block["assertions"].sort(key=lambda a: (a[0], a[1]))
        out_blocks.append({
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
        })
    return {
        "parsed": True,
        "normalized": normalized,
        "tests": out_blocks,
        "mocks": [{"callee": m[2], "specifier": m[3], "line": m[0]} for m in mocks],
    }


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
        "name": node.name,
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
