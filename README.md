# Elm AST for TypeScript

This is a 0.1.0 preview. It parses Elm module headers, imports, type aliases, unions, and type annotations into TypeScript values. It resolves types across project modules and installed package docs, including recursive types. It can also print generated declarations from a typed expression tree, adding imports for qualified references.

The parser keeps existing function bodies as source text. Generated function bodies are built from the expression AST and printed as Elm. `typeModuleFromParsed` copies parsed type declarations; it does not copy functions or comments. The writer covers the expressions needed by the current codec generator, not every Elm expression. Keep using the Elm compiler to check generated code. The API is still changing; check generated Elm with the Elm compiler.

Install it with `npm install @n1kben/elm-ast effect`.

```ts
import { parseModule } from "@n1kben/elm-ast";
import { openProject } from "@n1kben/elm-ast/project";
import { Effect } from "effect";

const project = Effect.runSync(openProject("."));
const component = Effect.runSync(project.module("Ui.DatePicker"));
const input = component.declarations.find((item) => item.kind === "alias" && item.name === "Input");
```

`openProject` is an Effect that reads `elm.json`, indexes project source directories, and loads docs for installed dependencies from `ELM_HOME`. File and parse failures are returned as `ProjectError` values. `module` and `resolveType` return `ProjectLookupError` for missing or ambiguous declarations. `collectTypeGraph` returns an Effect that finds declarations reachable from boundary types and reports unsupported types as `TypeGraphError`. Generated modules use `createModule`, `ref`, and `printModule` from `@n1kben/elm-ast/emit`; the printer adds imports referenced by expressions and types.

This repository provides the parser, type graph, and Elm source writer. The [Elm web components](https://github.com/n1kben/elm-web-components) project is testing these APIs as the basis for a future TypeScript generator. The component CLI still uses its Elm generator.
