import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { createModule, local, printModule, printTypeAnnotation, ref, typeModuleFromParsed } from "../src/emit.ts";
import { parseModule, parseTypeAnnotation } from "../src/index.ts";
import { openProject } from "../src/project.ts";
import { collectTypeGraph } from "../src/type-graph.ts";

test("parses Elm headers, imports, recursive unions, and opaque function bodies", () => {
  const source = `module Data.Tree exposing (Tree(..), map)
import List exposing (map)
type Tree a = Leaf a | Branch (Tree a) (Tree a)
map = List.map identity
`;

  const module = parseModule(source);
  assert.equal(module.name, "Data.Tree");
  assert.equal(module.imports[0]?.module, "List");
  assert.equal(module.declarations.find((item) => item.kind === "union")?.name, "Tree");
  const body = module.declarations.find((item) => item.kind === "value");
  assert.ok(body?.kind === "value");
  assert.equal(body.head, "List.map");
});

test("round-trips nested type annotations", () => {
  for (const source of [
    "Tree (Maybe String)",
    "(Data.Tree { left : Int }) -> String",
    "{ left : Tree a, right : Result String (List Int) }",
    "( Int, { a : String }, Maybe Float )",
    "(a -> b) -> List b",
  ]) {
    const parsed = parseTypeAnnotation(source);
    assert.deepEqual(parseTypeAnnotation(printTypeAnnotation(parsed)), parsed);
  }
});

test("prints generated function bodies and collects imports", () => {
  const module = createModule("Generated.Example");
  module.declarations.push({
    kind: "function",
    name: "encode",
    arguments: [{ kind: "variable", name: "value" }],
    body: { kind: "apply", function: ref("Json.Encode", "string"), arguments: [{ kind: "reference", name: "value" }] },
  });
  const source = printModule(module);
  assert.match(source, /import Json\.Encode/);
  assert.match(source, /encode value =/);
  assert.match(source, /Json\.Encode\.string value/);
});

test("printed constructor arguments are grouped and omitted values are not exposed", () => {
  const parsed = parseModule("module Example exposing (Box(..), value)\ntype Box a = Box a\nvalue = 1\n");
  const module = typeModuleFromParsed(parsed);
  const pattern = { kind: "constructor" as const, reference: local("Box"), arguments: [{ kind: "variable" as const, name: "item" }] };
  module.declarations.push({ kind: "function", name: "unwrap", arguments: [pattern], body: local("item") });
  module.declarations.push({ kind: "function", name: "unwrapLambda", arguments: [], body: { kind: "lambda", arguments: [pattern], body: local("item") } });
  const source = printModule(module);
  assert.match(source, /module Example exposing \(Box\(\.\.\)\)/);
  assert.match(source, /unwrap \(Box item\) =/);
  assert.match(source, /\\\(Box item\) ->/);
  assert.doesNotMatch(source, /exposing \([^)]*value/);
});

test("loads project modules lazily and resolves recursive imports", () => {
  const root = mkdtempSync(join(tmpdir(), "elm-ast-project-"));
  const load = openProject(root, join(root, ".elm-home"));

  try {
    const missing = Effect.runSync(Effect.either(load));
    assert.ok(Either.isLeft(missing));
    assert.equal(missing.left._tag, "ProjectError");
    assert.equal(missing.left.path, join(root, "elm.json"));

    writeFileSync(join(root, "elm.json"), JSON.stringify({ type: "application" }));
    const malformed = Effect.runSync(Effect.either(load));
    assert.ok(Either.isLeft(malformed));
    assert.match(malformed.left.message, /invalid Elm application/);

    mkdirSync(join(root, "src/Data"), { recursive: true });
    mkdirSync(join(root, "src/Ui"), { recursive: true });
    mkdirSync(join(root, "src/WebComponents"), { recursive: true });
    writeFileSync(join(root, "elm.json"), JSON.stringify({
      type: "application", "elm-version": "0.19.1", "source-directories": ["src"],
      dependencies: { direct: {}, indirect: {} },
    }));
    writeFileSync(join(root, "src/Data/Tree.elm"), "module Data.Tree exposing (Tree(..))\ntype Tree a = Leaf a | Branch (Tree a)\n");
    writeFileSync(join(root, "src/Ui/Example.elm"), "module Ui.Example exposing (Input)\nimport Data.Tree exposing (Tree)\ntype alias Input = { tree : Tree String }\n");
    writeFileSync(join(root, "src/WebComponents/Handwritten.elm"), "module WebComponents.Handwritten exposing (Flag)\ntype alias Flag = Bool\n");

    const project = Effect.runSync(load);
    assert.equal(Effect.runSync(project.module("WebComponents.Handwritten")).name, "WebComponents.Handwritten");
    const missingModule = Effect.runSync(Effect.either(project.module("Missing")));
    assert.ok(Either.isLeft(missingModule));
    assert.equal(missingModule.left._tag, "ProjectLookupError");

    const input = Effect.runSync(project.module("Ui.Example")).declarations.find((item) => item.kind === "alias" && item.name === "Input");
    assert.ok(input?.kind === "alias");
    const graph = Effect.runSync(collectTypeGraph(project, "Ui.Example", [input.type]));
    assert.deepEqual([...graph.keys()], ["Data.Tree.Tree"]);
    assert.deepEqual(graph.get("Data.Tree.Tree")?.dependencies, ["Data.Tree.Tree"]);
    const unsupported = Effect.runSync(Effect.either(collectTypeGraph(project, "Ui.Example", [{ kind: "function", argument: parseTypeAnnotation("Int"), result: parseTypeAnnotation("Int") }])));
    assert.ok(Either.isLeft(unsupported));
    assert.equal(unsupported.left._tag, "TypeGraphError");

    writeFileSync(join(root, "src/Ui/Broken.elm"), "invalid Elm source");
    const invalid = Effect.runSync(Effect.either(load));
    assert.ok(Either.isLeft(invalid));
    assert.equal(invalid.left.path, join(root, "src/Ui/Broken.elm"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("malformed package docs fail in the typed channel", () => {
  const root = mkdtempSync(join(tmpdir(), "elm-ast-docs-"));
  const docsPath = join(root, ".elm-home/0.19.1/packages/example/pkg/1.0.0/docs.json");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, ".elm-home/0.19.1/packages/example/pkg/1.0.0"), { recursive: true });
  writeFileSync(join(root, "elm.json"), JSON.stringify({
    type: "application", "elm-version": "0.19.1", "source-directories": ["src"],
    dependencies: { direct: { "example/pkg": "1.0.0" }, indirect: {} },
  }));

  try {
    for (const docs of ["{}", '[{"name":"Example"}]']) {
      writeFileSync(docsPath, docs);
      const result = Effect.runSync(Effect.either(openProject(root, join(root, ".elm-home"))));
      assert.ok(Either.isLeft(result));
      assert.equal(result.left.path, docsPath);
    }

    writeFileSync(docsPath, '[{"name":"Example","aliases":[{"name":"Broken","args":[],"type":"???"}],"unions":[]}]');
    const project = Effect.runSync(openProject(root, join(root, ".elm-home")));
    const invalidType = Effect.runSync(Effect.either(project.resolveType("Example", { kind: "named", module: ["Example"], name: "Broken", arguments: [] })));
    assert.ok(Either.isLeft(invalidType));
    assert.equal(invalidType.left._tag, "ProjectLookupError");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
