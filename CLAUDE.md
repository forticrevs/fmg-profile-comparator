# FMG Profile Comparator — Claude Code Guide

## Project overview

FortiManager profile comparison and policy analysis tool. FastAPI backend
(Python 3.12) talks to FortiManager appliances via JSON-RPC; Next.js 16 /
React 19 / Tailwind v4 frontend. Redis + ARQ for background jobs.

## Commands

```bash
# Backend (FastAPI, port 8000)
cd backend && venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# ARQ worker (must restart when new tasks are added)
cd backend && venv/bin/arq app.jobs.worker.WorkerSettings

# Redis (podman)
./scripts/start-redis.sh

# Frontend (Next.js, port 3002)
cd frontend && npm run dev

# Type-check frontend before pushing
cd frontend && npx tsc --noEmit
```

## Architecture

### Backend (`backend/app/`)
- **Entry:** `main.py`
- **Routers:** `auth`, `profiles`, `reference`, `settings`, `jobs`,
  `schemas`, `tools_pan`, `tools_diff`, `tools_policy_viewer`,
  `tools_policy_shadow`
- **Services:** `comparator`, `fmg_client`, `fmg_registry`, `auth`,
  `id_resolver`, `pin_store`, `user_store`, `schema_cache`,
  `policy_fetcher`, `object_resolver`, `file_security`, `diff_engine`,
  `pan_parsers/`
- **Jobs:** `backend/app/jobs/` — ARQ tasks: `ping`, `pan_extract`,
  `policy_shadow`
- **Auth:** Local users (bcrypt) + per-instance FMG sessions, JWT (8h)

### Frontend (`frontend/`)
- **Next.js 16.2 / React 19** — NOT the version in most training data.
  Read `node_modules/next/dist/docs/` before touching framework internals.
- **Pages:** `/`, `/login`, `/settings`, `/compare/[type]`,
  `/reference/*`, `/tools`, `/tools/pan-xml`, `/tools/diff`,
  `/tools/policy-viewer`, `/tools/policy-shadow`
- **Key shared components:** `ActionBadge`, `FieldVisibilityMenu`,
  `ComparisonTable`, `StructuredCollectionComparison`, `DataGrid`,
  `AuthGuard`

## Critical rules

### Multi-FMG is per-session
Backend handlers must use `fmg_client: FMGClient = Depends(get_current_fmg)`.
There is NO global FMG client — the registry resolves the active instance
from the JWT session. A singleton will break the moment two users connect to
different FMGs.

### No fixed FMG schema
Every column is discovered from the data itself. Any logic that assumes a
known field set will break when FMG adds a field.

### Route ordering in `profiles.py` is load-bearing
Static routes (`/types`, `/{type}/compare`, `/{type}/pins`) MUST come before
`/{profile_type}/{name}` or FastAPI swallows them as path params.

### `flatten()` keeps arrays-of-scalars as a single list value
Don't re-explode them into per-index leaves. Scalar-list comparison is
order-independent (`["smtp","pop3"] == ["pop3","smtp"]`). Breaking this
silently regresses DLP rendering to vertical-letter soup.

### Resolved values are `{raw, display}` dicts
Any new cell renderer must check `isResolved(v)` before stringifying or
it'll show `[object Object]`.

### Reuse shared components — don't duplicate logic
- **Action/severity colours:** extend `ActionBadge.tsx`, don't add new
  colour logic elsewhere.
- **Field visibility:** reuse `FieldVisibilityMenu.tsx` with a unique
  `storageKey`.
- **Collection alignment:** extend `entryMatchKey()` in
  `StructuredCollectionComparison.tsx` for new match keys.

### `EXCLUDED_FIELDS` in `comparator.py`
Canonical list of fields never meaningful to compare (`oid`, `uuid`,
`obj seq`, `name`). Add to it instead of filtering at call sites.

## Secrets & sensitive files

**Never commit any of these** — all are in `.gitignore`:
- `.env`, `.fmg_key`, `*_store.json`, `fmg_instances.json`
- `AGENTS.md` (root), `CHECKPOINT.md`, `todos.md`, `instructions.md`
- `reference material/`, `screenshots/`, `image*.png`

**`backend/.fmg_key`** is the Fernet key that encrypts
`fmg_instances.json`. Losing or rotating it bricks every stored instance.

**Never `git add -A` or `git add .`** — always stage explicit paths.

**Scrub customer-identifying info** (real names, IPs, ADOMs, hostnames)
from any content that reaches the git repo.

## FMG API notes

- `excluded: true` in syntax responses is NOT a filter signal — keep
  those attributes.
- Reference endpoints (`_application/list`, `_rule/list`, `_fdsdb/*`)
  return data, not schemas — don't pass syntax options to them.
