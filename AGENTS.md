# AGENTS.md — MapBridge project conventions

Conventions for working in this repo. Keep these in mind for every task.

## Language
- **Commit messages: always English.**
- **Public docs** (README.md, CHANGELOG.md, LICENSE, anything shipped to the public repo) must be **English**.
- Internal docs under `docs/` are private and may be Chinese.
- This repo is the public GitHub project `QueenKunkun/mapbridge`. Private material (real captured fixtures, internal docs, CDP debug scripts) must never be committed here.

## Workflow
- **Commit after every change** (user's standing instruction) — do not batch unrelated changes, but each completed change gets a commit.
- Maintain `CHANGELOG.md` (Keep a Changelog spec) with every user-visible change; entries in English.
- Dev-only features must be gated by `import.meta.env.DEV` so production builds tree-shake them.
- After code changes: run `pnpm compile` and `pnpm test` (24 tests) before committing.

## Release
- When the user asks to release, publish, bump the version, or create a production release, use the global `release` skill.
- Release tags are authoritative; do not infer the last released version from `package.json`.

## Status / roadmap
- Supported: baidu → amap extraction & import (verified live). Tencent is **not** supported yet — hidden from the popup provider list (`SELECTABLE_PROVIDERS` filters `tencent`); un-hide when the adapter is done.
- Amap clear/backup dev tool lives in options page (dev build only).
