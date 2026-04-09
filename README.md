# FortiManager Profile Comparator

A side-by-side configuration drift inspector for FortiManager security profiles
and SD-WAN templates. Pulls profiles via JSON-RPC, flattens them into a
field-level matrix, and highlights where cloned profiles have diverged.

![Stack](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![Stack](https://img.shields.io/badge/React-19-61dafb?logo=react)
![Stack](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)
![Stack](https://img.shields.io/badge/Tailwind-4-38bdf8?logo=tailwindcss)

## Why

When a "golden" FortiManager profile is cloned, the clone's configuration is
fully decoupled from the original. Drift accumulates silently, and manually
auditing dozens of profiles across Application Control, Web Filter, IPS, DLP,
and SD-WAN is impractical. This tool surfaces every diverged field at a glance
and lets you **pin** the fields that *must* stay consistent so future drift
trips a loud alert.

## Supported profile types

| Type | FMG path | URL ID |
|------|----------|--------|
| Application Control | Security Profiles > Application Control | `application` |
| Web Filter | Security Profiles > Web Filter | `webfilter` |
| IPS Sensor | Security Profiles > IPS Sensor | `ips` |
| DLP Profile | Security Profiles > DLP | `dlp` |
| SD-WAN Template | SD-WAN > Templates | `sdwan` |

## Architecture

```
┌─ Next.js 16 / React 19 / Tailwind 4 ──────────────┐
│  app/                                             │
│    page.tsx               dashboard + picker      │
│    compare/               comparison view         │
│    reference/             FMG reference explorer  │
│    settings/              FMG instance management │
│    login/                 auth                    │
│  components/                                      │
│    ComparisonTable           flat field matrix    │
│    StructuredCollection…     nested object tables │
│    ReferenceExplorer         searchable refs      │
│    FieldVisibilityMenu       per-page column hide │
│    ActionBadge               shared verdict pills │
│    AuthGuard, ProfileDashboard, ProfilePicker     │
│  lib/api.ts                  fetch wrappers       │
└──────────────────────┬────────────────────────────┘
                       │ REST (cookie-based session)
┌──────────────────────▼────────────────────────────┐
│ FastAPI backend                                   │
│  routers/                                         │
│    auth          login/register/connect-fmg      │
│    profiles      list/detail/compare/pins        │
│    reference     app sigs, ips sigs, dlp dicts   │
│    settings      multi-FMG instance CRUD         │
│  services/                                        │
│    fmg_client      JSON-RPC client + session     │
│    fmg_registry    multi-instance registry       │
│    comparator      flatten + diff engine         │
│    id_resolver     ID → human name enrichment    │
│    pin_store       per-type pin persistence      │
│    user_store      bcrypt user store             │
│    auth            session tokens                │
└──────────────────────┬────────────────────────────┘
                       │ JSON-RPC over HTTPS
                       ▼
                 FortiManager
```

## Comparator engine — how it works

The diff engine lives in [backend/app/services/comparator.py](backend/app/services/comparator.py).

1. **`flatten(obj)`** turns a nested FMG profile dict into dot/bracket-notation
   keys, e.g. `ftgd-wf.filters[3].action`. **Arrays of pure scalars** (e.g.
   `full-archive-proto: ["smtp","pop3","imap"]`) are kept as a single list
   value rather than exploded into per-index leaves — they render as a
   comma-joined cell.
2. **`find_collection_keys(profiles)`** walks every profile recursively and
   records the dot-paths of every *array-of-dicts* it finds. These paths get
   rendered structurally by the frontend (`StructuredCollectionComparison`)
   and are excluded from the flat comparison so the same data isn't shown
   twice.
3. **`compare_profiles(profiles, resolver, excluded_roots)`** flattens each
   profile, takes the union of keys (skipping `EXCLUDED_FIELDS = {oid, uuid,
   obj seq, name}` and any key under a collection root), and emits one
   `ComparisonField` per key with `values: {profile_name → value}` and an
   `in_sync` flag. Scalar lists are compared **order-independently**, so
   `["smtp","pop3"]` matches `["pop3","smtp"]`.
4. The optional **`IDResolver`** ([id_resolver.py](backend/app/services/id_resolver.py))
   wraps raw IDs in `{raw, display}` for fields it recognises (web filter
   categories, application categories, application sig IDs, URL filter table
   refs, IPS rule IDs). The frontend prefers `display` and shows `raw` in the
   tooltip.

## Frontend rendering rules

- **Flat fields** → [ComparisonTable.tsx](frontend/components/ComparisonTable.tsx).
  Groups by top-level key (or `arrayName[idx]` for indexed buckets), with
  collapsible sections, sync filter, search, pin toggles, and a per-profile-type
  field visibility menu (hidden leaf names persisted in
  `localStorage["fieldvis:comparison:<type>"]`).
- **Object collections** (anything `find_collection_keys` returned) →
  [StructuredCollectionComparison.tsx](frontend/components/StructuredCollectionComparison.tsx).
  Renders one row per matched entry across profiles. Entry alignment uses a
  `entryMatchKey()` heuristic: web filter category filters align by category
  display name, URL filter entries align by normalised URL, everything else
  by `name`/`id`. Per-collection column visibility persisted under
  `localStorage["fieldvis:scc:<collectionKey>"]`.
- **Action verdicts** → [ActionBadge.tsx](frontend/components/ActionBadge.tsx)
  is the single source of truth for verdict colour-coding (red=block/deny/drop,
  green=allow/permit/accept, blue=monitor/log, orange=warn/alert, grey=
  exempt/skip/bypass). `isActionKey()` is used by every comparison view to
  decide when a cell should render as a pill — match is on the leaf field
  name (`action`, `default-action`, `block-action`, `*-action`, but NOT
  `rate-mode`).
- **Reference data** → [ReferenceExplorer.tsx](frontend/components/ReferenceExplorer.tsx)
  shows searchable tables of FMG reference data (application signatures, IPS
  signatures, DLP sensors/dicts/data-types) with the same column-hide menu
  (`fieldvis:ref:<kind>`).

## API surface

All routes are cookie-authenticated (set on `/api/auth/login`).

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/register` | Create the first/any user |
| `POST` | `/api/auth/login` | Username + password → session cookie |
| `POST` | `/api/auth/logout` | Drop session |
| `GET` | `/api/auth/verify` | Whoami |
| `POST` | `/api/auth/connect-fmg` | Bind a FMG instance to the session |
| `GET` | `/api/auth/setup-required` | True if no users exist yet |
| `GET` | `/api/settings/fmg-instances` | List configured FMG instances |
| `POST/PUT/DELETE` | `/api/settings/fmg-instances[/{id}]` | CRUD FMG instances |
| `GET` | `/api/profiles/types` | List profile types |
| `GET` | `/api/profiles/{type}` | List profile names for a type |
| `GET` | `/api/profiles/{type}/{name}` | Full raw profile |
| `GET` | `/api/profiles/{type}/compare?name=A&name=B…` | Comparison response |
| `GET` | `/api/profiles/{type}/pins` | Pinned field paths for a type |
| `POST` | `/api/profiles/{type}/pins` | Toggle a pin |
| `GET` | `/api/reference/application-signatures` | App sig catalogue |
| `GET` | `/api/reference/ips-signatures` | IPS sig catalogue |
| `GET` | `/api/reference/dlp-sensors` | DLP sensors |
| `GET` | `/api/reference/dlp-dictionaries` | DLP dictionaries |
| `GET` | `/api/reference/dlp-data-types` | DLP data types |

The compare endpoint returns:
```jsonc
{
  "profile_type": "webfilter",
  "profile_names": ["A", "B"],
  "fields": [{ "field_path": "...", "label": "...", "values": {...}, "in_sync": false }],
  "collection_keys": ["ftgd-wf.filters", "_url_filter.entries"],
  "raw_profiles": { "A": {...}, "B": {...} },
  "defaults": {}
}
```

## Persistence

Backend state is plain JSON files next to the backend (gitignored):

- `backend/user_store.json` — bcrypt user records
- `backend/pin_store.json` — `{ profile_type: [field_path, ...] }`
- `backend/fmg_instances.json` — encrypted FMG credentials
- `backend/.fmg_key` — Fernet key used to encrypt the above

Frontend state lives in `localStorage`:

- `fieldvis:comparison:<type>` — hidden leaf field names per profile-type page
- `fieldvis:scc:<collectionKey>` — hidden columns per structured collection
- `fieldvis:ref:<kind>` — hidden columns per reference page

## Quick start

Prereqs: Python 3.10+, Node 18+, a FortiManager with JSON-RPC API access.

```bash
# Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (separate shell)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000, register the first user, then add your FMG
instance from the Settings page.

## Notes for future agents

- **Next.js here is 16.2 / React 19**, not the version most LLMs were trained
  on. APIs and conventions differ — see [frontend/AGENTS.md](frontend/AGENTS.md)
  and `node_modules/next/dist/docs/` before touching frontend infra.
- **Don't add new action-colour logic anywhere** — extend
  [ActionBadge.tsx](frontend/components/ActionBadge.tsx) and call it.
- **Don't add new field-visibility UIs** — reuse
  [FieldVisibilityMenu.tsx](frontend/components/FieldVisibilityMenu.tsx) with
  a unique `storageKey`.
- **The backend has no fixed FMG schema** — every column is discovered from
  the data itself. Any logic that assumes a known field set will break the
  next time FMG adds one.
- **`EXCLUDED_FIELDS`** in [comparator.py](backend/app/services/comparator.py)
  is the canonical list of fields that are *never* meaningful to compare
  (`oid`, `uuid`, `obj seq`, `name`). Add to it instead of filtering at
  call sites.
- Sensitive files are in `.gitignore`: `.env`, `.fmg_key`, `*_store.json`,
  `fmg_instances.json`, screenshots. Re-check before committing.

## License

MIT
