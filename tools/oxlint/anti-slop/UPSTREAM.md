# Upstream source

The plugin was copied from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) at commit `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`. The copy used upstream's `skills/install-anti-slop/scripts/install.mjs` script.

The installed plugin lives in `tools/oxlint/anti-slop/`. `oxlint.config.ts` enables its generic rules.

The copied plugin sources are unchanged. This repository uses the generic rules; its Effect code does not use the service and Layer patterns covered by the optional Effect rules. The upstream MIT license is in this directory. The Stylistic license and provenance are in `vendor/eslint-stylistic/`.
