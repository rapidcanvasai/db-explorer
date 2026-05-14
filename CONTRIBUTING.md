# Contributing

Thanks for your interest in DB Explorer. The repo is intentionally small — keep PRs surgical.

## Development setup

```bash
make setup        # venv + deps
make db-up        # optional local MySQL
make dev          # backend + frontend
```

## Before opening a PR

- `cd dashboard && npm run build` passes (typecheck + bundler).
- Backend changes should keep the read-only invariant — only `SELECT/SHOW/DESCRIBE/EXPLAIN` may pass `validate_readonly`.
- Don't commit anything that ends up under `.gitignore` (no real `.env`, no `infra/.rapidcanvas*` without the `.example` suffix).
- Match existing styling — Tailwind utility classes, lowercase semantic CSS vars (`bg-background`, `text-foreground`), no inline hex colors.

## Scope guidance

Good fits for this repo:
- Query editor UX improvements (autocomplete, snippets, themes, shortcuts).
- New read-only views (indexes, foreign keys, ER snapshot).
- Better env / connection UX.

Out of scope:
- Write operations of any kind.
- Multi-DB-engine support (this is MySQL-only by design; fork for Postgres).
- Heavy auth / RBAC layers — auth lives in front of the DataApp on RapidCanvas.

## Reporting issues

Open a GitHub issue with: env (LOCAL/DEV/PROD), MySQL version, browser, and a minimal reproduction.
