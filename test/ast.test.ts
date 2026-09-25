import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { createModule, printModule, printTypeAnnotation, ref } from "../src/emit.ts";
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

test("loads project modules lazily and resolves recursive imports", () => {
  const root = mkdtempSync(join(tmpdir(), "elm-ast-project-"));
  const load = openProject(root, join(root, ".elm-home"));

  try {
    const missing = Effect.runSync(Effect.either(load));
    assert.ok(Either.isLeft(missing));
    assert.equal(missing.left._tag, "ProjectError");
    assert.equal(missing.left.path, join(root, "elm.json"));

    mkdirSync(join(root, "src/Data"), { recursive: true });
    mkdirSync(join(root, "src/Ui"), { recursive: true });
    writeFileSync(join(root, "elm.json"), JSON.stringify({
      type: "application", "elm-version": "0.19.1", "source-directories": ["src"],
      dependencies: { direct: {}, indirect: {} },
    }));
    writeFileSync(join(root, "src/Data/Tree.elm"), "module Data.Tree exposing (Tree(..))\ntype Tree a = Leaf a | Branch (Tree a)\n");
    writeFileSync(join(root, "src/Ui/Example.elm"), "module Ui.Example exposing (Input)\nimport Data.Tree exposing (Tree)\ntype alias Input = { tree : Tree String }\n");

    const project = Effect.runSync(load);
    const input = project.module("Ui.Example").declarations.find((item) => item.kind === "alias" && item.name === "Input");
    assert.ok(input?.kind === "alias");
    const graph = collectTypeGraph(project, "Ui.Example", [input.type]);
    assert.deepEqual([...graph.keys()], ["Data.Tree.Tree"]);
    assert.deepEqual(graph.get("Data.Tree.Tree")?.dependencies, ["Data.Tree.Tree"]);

    writeFileSync(join(root, "src/Ui/Broken.elm"), "invalid Elm source");
    const invalid = Effect.runSync(Effect.either(load));
    assert.ok(Either.isLeft(invalid));
    assert.equal(invalid.left.path, join(root, "src/Ui/Broken.elm"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
