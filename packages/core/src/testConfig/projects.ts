import { entriesOf, type ListMode, narrowedList, widenedList } from "./listCompare.js";
import { type ConfigValue, lookup, printValue } from "./value.js";

/** Which test runner's project objects are read: vitest keeps its settings under `test`, jest at the top of the object. */
export type ProjectsFlavor = "vitest" | "jest";

type Outcome = "narrowed" | "cannot" | null;

/** A key of a project object that lists what the project runs; `narrowed` keys lose coverage when they shrink. */
interface ProjectKey {
  path: readonly string[];
  kind: "narrowed" | "widened";
  list: ListMode;
}

const PROJECT_KEYS: Readonly<Record<ProjectsFlavor, readonly ProjectKey[]>> = {
  vitest: [
    { path: ["test", "include"], kind: "narrowed", list: "glob" },
    { path: ["test", "exclude"], kind: "widened", list: "glob" },
  ],
  jest: [
    { path: ["testMatch"], kind: "narrowed", list: "glob" },
    { path: ["testRegex"], kind: "narrowed", list: "regex" },
    { path: ["testPathIgnorePatterns"], kind: "widened", list: "regex" },
  ],
};

/** Where a project's name is written, and the property that holds it when the name is an object. */
const NAME: Readonly<Record<ProjectsFlavor, { path: readonly string[]; field: string }>> = {
  vitest: { path: ["test", "name"], field: "label" },
  jest: { path: ["displayName"], field: "name" },
};

const isObject = (value: ConfigValue): boolean => value.type === "object";

/** The items of a `projects` value: an array gives its items, anything else is one item. */
function itemsOf(value: ConfigValue): ConfigValue[] {
  return value.type === "array" ? value.items : [value];
}

/** The name of a project object: a string, or the string property of an object name; null when it has none. */
function nameOf(project: ConfigValue, flavor: ProjectsFlavor): string | null {
  const { path, field } = NAME[flavor];
  const look = lookup(project, path);
  if (typeof look !== "object") return null;
  const value = look.found.value;
  if (value.type === "string") return value.value;
  if (value.type !== "object") return null;
  const inner = lookup(value, [field]);
  if (typeof inner !== "object") return null;
  return inner.found.value.type === "string" ? inner.found.value.value : null;
}

/** Narrowed beats cannot beats nothing. */
const fold = (a: Outcome, b: Outcome): Outcome =>
  a === "narrowed" || b === "narrowed" ? "narrowed" : a === "cannot" || b === "cannot" ? "cannot" : null;

/**
 * One list key of a matched project pair, with the top-level semantics of a settings key: equal prints give nothing, a
 * base that may hold the key anywhere gives nothing, a head without the key gives nothing, a head that may hold the key
 * while the base sets it cannot be compared, a narrowed key with no base value gives nothing and a widened key with
 * no base value starts from an empty list.
 */
function compareKey(base: ConfigValue, head: ConfigValue, key: ProjectKey): Outcome {
  const b = lookup(base, key.path);
  const h = lookup(head, key.path);
  const baseValue = typeof b === "object" ? b.found.value : null;
  const headValue = typeof h === "object" ? h.found.value : null;
  if (baseValue !== null && headValue !== null && printValue(baseValue) === printValue(headValue)) return null;
  if (b === "unknown" || h === "unset") return null;
  if (headValue === null) return baseValue !== null ? "cannot" : null;
  const headEntries = entriesOf(headValue, false);
  if (key.kind === "narrowed") {
    return baseValue === null ? null : narrowedList(entriesOf(baseValue, false), headEntries, key.list);
  }
  const result = widenedList(baseValue === null ? [] : entriesOf(baseValue, false), headEntries, key.list);
  return result === "widened" ? "narrowed" : result;
}

const listOf = (items: ConfigValue[]): ConfigValue => ({ type: "array", items });

/**
 * Compares a `projects` list at base and at head by project identity instead of as a flat list of entries. Object
 * projects are matched by name (vitest `test.name`, jest `displayName`), then by position for a base project whose name
 * is gone at head; a matched pair is judged on its test-list keys only, so any other key may change freely. A base
 * project with no head match is `narrowed`, or `cannot` when the head gains an opaque entry. The other entries (glob
 * strings and anything that is not an object) are compared as a glob list, as before. `narrowed` beats `cannot`.
 */
export function compareProjects(base: ConfigValue, head: ConfigValue, flavor: ProjectsFlavor): Outcome {
  const baseItems = itemsOf(base);
  const headItems = itemsOf(head);
  const baseObjects = baseItems.filter(isObject);
  const headObjects = headItems.filter(isObject);
  const baseOthers = baseItems.filter((item) => !isObject(item));
  const headOthers = headItems.filter((item) => !isObject(item));

  let outcome: Outcome = narrowedList(
    entriesOf(listOf(baseOthers), false),
    entriesOf(listOf(headOthers), false),
    "glob",
  );

  const baseNames = baseObjects.map((project) => nameOf(project, flavor));
  const headNames = headObjects.map((project) => nameOf(project, flavor));
  const baseNameSet = new Set(baseNames.filter((name): name is string => name !== null));

  const headByName = new Map<string, { indexes: number[]; next: number }>();
  headNames.forEach((name, index) => {
    if (name === null) return;
    const queue = headByName.get(name);
    if (queue === undefined) headByName.set(name, { indexes: [index], next: 0 });
    else queue.indexes.push(index);
  });

  const matchOf = new Array<number>(baseObjects.length).fill(-1);
  const taken = new Set<number>();
  baseNames.forEach((name, index) => {
    const queue = name === null ? undefined : headByName.get(name);
    if (queue === undefined || queue.next >= queue.indexes.length) return;
    const match = queue.indexes[queue.next] as number;
    queue.next += 1;
    matchOf[index] = match;
    taken.add(match);
  });
  matchOf.forEach((match, index) => {
    if (match !== -1 || index >= headObjects.length || taken.has(index)) return;
    const headName = headNames[index] as string | null;
    if (headName !== null && baseNameSet.has(headName)) return;
    matchOf[index] = index;
    taken.add(index);
  });

  const baseOpaque = new Set(
    baseOthers.filter((item) => item.type === "opaque").map((item) => (item as { text: string }).text),
  );
  const gainsOpaque = headOthers.some((item) => item.type === "opaque" && !baseOpaque.has(item.text));

  baseObjects.forEach((project, index) => {
    const match = matchOf[index] as number;
    if (match === -1) {
      outcome = fold(outcome, gainsOpaque ? "cannot" : "narrowed");
      return;
    }
    for (const key of PROJECT_KEYS[flavor]) {
      outcome = fold(outcome, compareKey(project, headObjects[match] as ConfigValue, key));
    }
  });
  return outcome;
}
