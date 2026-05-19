# FortiManager Profile Comparator

Inspection and migration workbench for FortiManager deployments. Started as a
side-by-side drift inspector for cloned security profiles; now also hosts
reference catalogs, signature encyclopedia lookups, a dense policy viewer
with live hit counts, a policy-shadow analyzer, an Internet Service Database
browser, optional AI assistant with provider-managed LLM/RAG context, a
multi-file config diff utility, and a Palo Alto →  FortiGate migration
extractor.

![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![React 19](https://img.shields.io/badge/React-19-61dafb?logo=react)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)
![Tailwind 4](https://img.shields.io/badge/Tailwind-4-38bdf8?logo=tailwindcss)
![Python 3.12](https://img.shields.io/badge/Python-3.12-3776ab?logo=python)
![Redis + ARQ](https://img.shields.io/badge/Redis%20%2B%20ARQ-jobs-dc382d?logo=redis)

## Why

When a "golden" FortiManager profile is cloned, the clone's configuration is
fully decoupled from the original. Drift accumulates silently, and manually
auditing dozens of profiles across Application Control, Web Filter, IPS, DLP,
and SD-WAN is impractical. This tool surfaces every diverged field at a glance,
lets you **pin** the fields that *must* stay consistent, and has grown to cover
the adjacent workflows operators reach for during audit and migration.

---

## Features

### Profile comparison (core)

Side-by-side drift inspector for **Application Control**, **Web Filter**,
**IPS Sensor**, **DLP**, and **SD-WAN Template** profiles. Pulls live config
via FMG JSON-RPC and flattens it into a field-level matrix.

- **N-way or baseline-anchored modes** — pick one profile as the drift anchor
  and every other column is diffed against it instead of N-way symmetric.
  The baseline column pins to the leftmost position with an emerald ambient
  pulse, drifting cells get a red left border and matching text treatment,
  and the choice persists per profile type. Star/clear controls ship in the
  header cell for one-click toggling.
- **Pin fields that must not drift.** Pinned paths persist per profile type;
  drift on a pinned field is highlighted distinctly so the next audit surfaces
  it immediately.
- **Data-driven schema.** Every column is discovered from the response
  payload. New FMG field? It shows up automatically — no code change.
- **ID enrichment.** Category IDs, URL filter table refs, IPS rule IDs, and
  application signature IDs get resolved to human-readable names, with the
  raw value in the hover tooltip.
- **Order-independent scalar-array comparison.** `["smtp","pop3"]` and
  `["pop3","smtp"]` are considered equal; DLP proto lists render as a single
  cell, not as vertical per-index leaves.
- **Structured collection alignment** — anything that flattens to an
  array-of-dicts (web filter categories, DLP filters, application entries)
  lines up across profiles by a semantic `entryMatchKey` heuristic, so the
  same entry still matches when array order differs.
- **Dedicated views for awkward structures.** Web filter URL filter lists
  render once with a "used by" chip strip instead of exploding into N
  identical subtables. Comment/description fields render through a
  click-to-expand preview that's diff-aware when a baseline is set.
- **Schema-backed field visibility menu.** Shows every field the FMG syntax
  knows about, dims the ones absent from the current payload, persists
  hidden sets per page.

### Reference catalogs

Searchable explorers for every FMG reference data source the tool understands.

| Catalog | Source | Notes |
|---------|--------|-------|
| Application Signatures | `/pm/config/adom/{adom}/_application/list` | Hover a name for the full FortiGuard encyclopedia card |
| IPS Signatures | `/pm/config/adom/{adom}/_rule/list` | Hover for encyclopedia card. Default columns pre-seeded for triage |
| DLP Sensors | `/pm/config/adom/{adom}/obj/dlp/sensor` | Full sensor catalog with nested entry tables |
| DLP Dictionaries | `/pm/config/adom/{adom}/obj/dlp/dictionary` | Pattern entries expanded |
| DLP Data Types | `/pm/config/adom/{adom}/obj/dlp/data-type` | Built-in types |
| Local Web Categories | `/pm/config/adom/{adom}/obj/webfilter/ftgd-local-cat` | Operator-defined FortiGuard category buckets with audit metadata |
| Web Rating Overrides | `/pm/config/adom/{adom}/obj/webfilter/ftgd-local-rating` | URL override catalog with resolved category names |
| Internet Services | FortiGuard ISDB via FMG `/sys/proxy/json` → FortiGate | FQDN catalog, full service directory, IP/FQDN lookup |
| Metadata Variables | `/pm/config/adom/{adom}/obj/fmg/variable` | Device-by-variable matrix with search, sorting, AI context, and CSV export |

#### Signature encyclopedia hover (IPS + Application)

Hover any signature name for a pop card with the full FortiGuard record: name,
risk, default action, summary, symptoms, analysis, recommended action, CVE,
vulnerability type, applicable OS / app, ports (app sigs), vendor (app sigs),
references, and release/update dates. Backed by FMG's **undocumented GUI CGI
API** — we log in via `/cgi-bin/module/flatui_auth`, capture the
`HTTP_CSRF_TOKEN` cookie, and then call `productapi` with an `XSRF-TOKEN`
header for each lookup. Records are cached for 24 hours per `(source, id)`,
so the second hover on a signature is instant.

#### Internet Service Database (ISDB) reference

FortiManager does not host the ISDB monitor APIs, so every lookup proxies
through FMG's `/sys/proxy/json` to a user-selected managed FortiGate.

- **FQDN catalog** — browse FortiGuard's SaaS FQDN groups as a searchable
  table (vendor, service, FQDN count, chip-rendered FQDN list). Cached 30
  minutes per `(fmg, device, vdom)` tuple.
- **Service catalog** — browse every FortiGuard Internet Service name exposed
  by the selected FortiGate. Rows load detailed IP ranges, ports, reputation,
  and disabled-entry data on demand through the same FMG proxy path.
- **IP lookup** — enter an IP (or FQDN, auto-resolved via DNS) and
  parallel-fire `reverse-ip-lookup`, `geoip-query`, `internet-service-match`,
  and `internet-service-reputation`. Match + reputation are merged by service
  id. Results render as a single card with reverse DNS, a GeoIP strip
  (country, region, postal, coordinates, timezone), and a matched-services
  table with reputation pips, popularity bars, and botnet/blocklist flags.
  Partial failures (e.g. no reverse DNS on a private IP) are reported
  per-section so the rest of the card still renders.

### Optional AI assistant, providers, and RAG

The floating AI assistant is an add-on workflow. Profile comparison,
reference browsing, ISDB lookup, route viewing, provisioning utilities, and
the migration tools all work without any AI provider, Ollama process, Qdrant
database, or RAG corpus.

- **Provider-managed chat.** Settings can store multiple LLM providers and the
  chat widget lets the user choose one per conversation. API keys are encrypted
  at rest in `backend/ai_providers.json` with the same Fernet key used for FMG
  instances.
- **Provider coverage.** Built-in UI presets cover local Ollama, OpenAI,
  Anthropic, Google Gemini, OpenRouter, FortiAIGate, vLLM, and any custom
  OpenAI-compatible endpoint that speaks `/v1/chat/completions`.
- **Context-aware prompts.** The frontend sends compact current-page context
  automatically, and high-value rows/cards expose an "add to chat context"
  action for one-shot attachments from profile comparisons, reference
  catalogs, signatures, and ISDB results.
- **Best-effort RAG.** When enabled and reachable, `/api/chat/message` embeds
  the user turn plus compact UI context, queries Qdrant, and injects Fortinet
  documentation excerpts ahead of the UI context. If Qdrant or the embedding
  server is down, the warning is logged and chat continues without RAG.
- **Default retrieval stack.** The app expects an already-populated Qdrant
  collection named `fortinet_docs`, built with `qwen3-embedding:8b`
  embeddings (`4096` dimensions) unless the `RAG_*` environment variables
  override those defaults.

### Tools

Migration utilities and operator conveniences under `/tools`.

| Tool | Purpose |
|------|---------|
| **PAN XML Extract** | Upload a Palo Alto `running-config.xml`, pick extractors, get back CSV / XLSX / FortiGate-CLI artifacts. Self-registering parsers for security rules, profile groups, app groups, custom URL categories, URL filter profiles, SSL decryption rules, and wildcard objects. Runs as an ARQ background job. |
| **Object migration compare** | Compare FortiConverter/FortiGate object CLI against same-named FMG objects before importing migrated address, address-group, service, service-group, local web category, SSL exemption, URL filter, wildcard FQDN, and wildcard FQDN group data. |
| **Jinja CLI template lab** | Import FMG CLI scripts/templates as local editable copies, author Jinja2 templates with FortiManager-style variables and filters, and render previews against live device database and metadata-variable context. |
| **FortiGate route viewer** | Query one or more FMG-managed FortiGates through `/sys/proxy/json` for `/api/v2/monitor/router/ipv4`, then filter and export routes by device, destination, gateway, interface, protocol, route type, VRF, and route class. |
| **ISDB reference and lookup** | Proxy through a selected FortiGate to browse ISDB FQDN groups, the service catalog, service details, and IP/FQDN enrichment results. |
| **Diff utility** | Upload up to `N` text / config files (`.txt`, `.conf`, `.cfg`, `.json`, `.xml`, `.yaml`), pick a baseline, see unified diffs. Layered defenses: size caps, extension allow-list, magic-byte sniff, NUL rejection, strict UTF-8, `defusedxml`, `yaml.safe_load`, in-memory only, per-user sliding-window rate limit. |
| **Policy viewer** | Dense, searchable view of firewall policies for the active ADOM. Schema-driven column discovery, per-column + global search, live hit counts and byte counters with a relative log-scale heatmap, expand-row full-policy detail pane, hover-resolved address/service tooltips, drag-to-reorder columns with persisted widths. |
| **Policy shadow** | Run the `fmg-policy-shadow` analyzer against one or more packages. Packages picked via regex or explicit list; outputs HTML/XLSX/JSON. Runs as a background ARQ job; artifacts downloaded through the generic job endpoint. |

#### PAN extractor matrix

| Extractor | Output | Purpose |
|-----------|--------|---------|
| Security Rules | `security-rules.csv` | Flat rulebase (zones, src/dst, action, profile group) |
| Profile Groups | `profile-groups.csv` | Profile-group → member profile map |
| Application Groups | `app-groups.xlsx` | One column per app-group, members vertically |
| Custom URL Categories | `custom-url-categories.csv` | One row per `(category, URL)` pair |
| URL Filter Profiles | `url-filter-profiles.xlsx` + `url-filter-all-categories.xlsx` | Per-profile alert/block sheets + unified category index |
| SSL Decryption Rules | `ssl-decryption-rules.csv` | Decryption policy with category, service, action, profile |
| Wildcard Address Objects | `wildcard-objects.ftnt.txt` | PAN `ip-wildcard` values converted to FortiGate complement-form `config firewall address` blocks |

All selected extractors run against a single parsed tree, outputs land in a
per-user job directory, and everything is bundled into a
`pan-extract-<job_id>.zip` for convenience.

---

## Architecture

```
┌─ Next.js 16 / React 19 / Tailwind 4 ───────────────────────┐
│ app/                                                       │
│   page.tsx                   dashboard + profile picker    │
│   reference/                 8 catalog explorers           │
│   tools/                     7 utility surfaces            │
│   settings/                  multi-FMG + AI provider CRUD  │
│   login/                     auth gateway                  │
│ components/                                                │
│   ComparisonTable            flat field matrix + baseline  │
│   StructuredCollection…      nested array-of-dict tables   │
│   UrlFilterComparison        webfilter URL list dedupe     │
│   WebFilterCategoryTable     category-keyed row alignment  │
│   CommentCell                click-to-expand diff preview  │
│   ReferenceExplorer          catalog table primitive       │
│   SignatureTooltip           portal hover encyclopedia     │
│   ChatWidget, ChatContext    optional contextual AI chat   │
│   AddToChatContextButton     one-shot chat attachments     │
│   DataGrid                   CSS-grid table primitive      │
│   FieldVisibilityMenu        schema-backed column hider    │
│   ActionBadge                shared verdict pills          │
│   AuthGuard, ProfileDashboard, ProfilePicker               │
│ lib/api.ts                   typed fetch wrappers          │
└──────────────────────┬─────────────────────────────────────┘
                       │ REST + JWT Bearer
┌──────────────────────▼─────────────────────────────────────┐
│ FastAPI backend                                            │
│ routers/                                                   │
│   auth                  login/register/connect-fmg         │
│   profiles              list/detail/compare/pins           │
│   reference             catalogs + encyclopedia            │
│   schemas               FMG syntax schema access           │
│   settings              multi-FMG instance CRUD            │
│   chat                  chat stream + AI provider API      │
│   jobs                  ARQ job status + artifact download │
│   tools_pan             PAN XML extraction                 │
│   tools_diff            multi-file text diff               │
│   tools_policy_viewer   firewall policy browser            │
│   tools_policy_shadow   policy shadow analyzer runner      │
│   tools_isdb            ISDB FQDN/catalog/IP proxy         │
│   tools_routes          FortiGate route table proxy        │
│   tools_object_migration object migration compare          │
│   tools_jinja_lab       local Jinja CLI template lab        │
│ services/                                                  │
│   fmg_client            JSON-RPC + undocumented CGI client │
│   fmg_registry          multi-instance (Fernet-encrypted)  │
│   comparator            flatten + N-way / baseline diff    │
│   id_resolver           ID → human-name enrichment         │
│   policy_fetcher        policy package + hitcount helpers  │
│   object_resolver       firewall object map (addrs/svcs)   │
│   route_viewer          FortiGate route normalizer          │
│   object_migration_compare object compare helpers          │
│   jinja_template_lab    local template/render helpers       │
│   schema_cache          FMG syntax schema cache            │
│   fos_proxy             /sys/proxy/json wrapper            │
│   diff_engine           unified diff generator             │
│   file_security         upload allow-list + safe parse     │
│   pan_parsers/          self-registering XML → CSV/XLSX    │
│   ai/                   providers + chat + RAG retrieval   │
│   pin_store             per-type pin persistence           │
│   user_store            bcrypt local user store            │
│   auth                  JWT issuance + per-session FMGs    │
│ jobs/                                                      │
│   worker.py             ARQ WorkerSettings                 │
│   queue.py              enqueue / status helpers           │
│   user_storage.py       per-user job directories           │
│   tasks/                ping, pan_extract, policy_shadow   │
└──────────────────────┬─────────────────────────────────────┘
                       │
          JSON-RPC  +  /sys/proxy/json  +  flatui_auth
                       │
                       ▼
                 FortiManager
                       │
                       │  /sys/proxy/json
                       ▼
             Managed FortiGate(s)

┌─ Optional AI / RAG services ───────────────────────────────┐
│  LLM provider: Ollama, OpenAI-compatible, Anthropic, Gemini │
│  Ollama embeddings: qwen3-embedding:8b via /api/embed      │
│  Qdrant: fortinet_docs collection with 4096-d vectors      │
└────────────────────────────────────────────────────────────┘

┌─ Redis + ARQ worker ───────────────────────────────────────┐
│  redis://localhost:6379   (podman container)               │
│  $ backend/venv/bin/arq app.jobs.worker.WorkerSettings     │
└────────────────────────────────────────────────────────────┘
```

### Critical design rules

- **Multi-FMG is per-session.** Every handler resolves its FMG client via
  `Depends(get_current_fmg)`, which pulls the active instance out of the JWT
  session's registry. There is **no global FMG client** — a singleton would
  break the moment two users connect to different FMGs.
- **No fixed FMG schema.** Column lists are always discovered from the data.
  Any logic that hard-codes a field set would break the first time FMG adds
  a field.
- **Route ordering in `profiles.py` is load-bearing.** Static routes
  (`/types`, `/{type}/compare`, `/{type}/pins`) must come before
  `/{profile_type}/{name}` or FastAPI swallows them as path params.
- **`flatten()` keeps arrays-of-scalars as a single list value.** Don't
  re-explode them into per-index leaves. Scalar-list comparison is
  order-independent, so DLP proto lists stay coherent.
- **Resolved values are `{raw, display}` dicts.** Any new cell renderer must
  check `isResolved(v)` before stringifying, or it'll show `[object Object]`.
- **AI and RAG are optional.** `/api/chat/message` can enrich prompts with
  page context and Fortinet-doc retrieval, but the comparator and tools do not
  depend on an LLM, embedding model, or Qdrant.

---

## Authentication & FMG session model

- **Local users** — bcrypt-hashed, persisted in `user_store.json`. First-run
  detection (`GET /api/auth/setup-required`) drives a mandatory registration
  step on a fresh deployment.
- **JWT bearer tokens** — HS256, 8-hour expiry. Generated on login and passed
  as `Authorization: Bearer <token>` by the frontend `authFetch` wrapper in
  `lib/api.ts`. Session state is a process-memory dict keyed on a SHA-256
  prefix of the token.
- **Multi-FMG registry** — each user can register multiple FMG instances.
  Credentials are encrypted at rest with a per-deployment Fernet key stored
  at `backend/.fmg_key`. Switching active instance updates the session's
  `active_instance_id`; every subsequent route resolves through the current
  choice.
- **Two FMG protocols** — the primary client speaks FMG JSON-RPC (`/jsonrpc`).
  For endpoints FMG doesn't mirror (signature encyclopedia), a second
  code path logs into the undocumented GUI CGI API
  (`/cgi-bin/module/flatui_auth`), captures `HTTP_CSRF_TOKEN`, and calls
  `/cgi-bin/module/productapi` with the token echoed in the `XSRF-TOKEN`
  header. Cookies ride the same `httpx.AsyncClient` instance, and session
  expiry triggers a silent re-auth once per request.

---

## Comparator engine

The diff engine lives in
[`backend/app/services/comparator.py`](backend/app/services/comparator.py).

1. **`flatten(obj)`** turns a nested FMG profile dict into dot/bracket
   notation keys, e.g. `ftgd-wf.filters[3].action`. Arrays of pure scalars
   (e.g. `full-archive-proto: ["smtp","pop3","imap"]`) are kept as a single
   list value rather than exploded into per-index leaves.
2. **`find_collection_keys(profiles)`** walks every profile recursively and
   records the dot-paths of every array-of-dicts. These paths get rendered
   structurally by `StructuredCollectionComparison` on the frontend and are
   excluded from the flat comparison so nothing shows up twice.
3. **`compare_profiles(profiles, resolver, excluded_roots, baseline=None)`**
   flattens each profile, takes the union of keys (skipping `EXCLUDED_FIELDS
   = {oid, uuid, obj seq, name}` and any key under a collection root), and
   emits one `ComparisonField` per key. When `baseline` is set, `in_sync`
   becomes "every non-baseline value matches the baseline" and each cell
   gets a per-profile `differs_from_baseline` entry; otherwise it's N-way
   symmetric.
4. **`IDResolver`** wraps raw IDs in `{raw, display}` for recognised fields
   (web filter categories, application categories, application sig IDs,
   URL filter table refs, IPS rule IDs). The frontend prefers `display`
   and shows `raw` in the hover tooltip.

The compare endpoint returns:

```jsonc
{
  "profile_type": "webfilter",
  "profile_names": ["A", "B", "C"],
  "fields": [
    {
      "field_path": "...",
      "label": "...",
      "values": { "A": ..., "B": ..., "C": ... },
      "in_sync": false,
      "differs_from_baseline": { "A": false, "B": true, "C": false }
    }
  ],
  "collection_keys": ["ftgd-wf.filters"],
  "raw_profiles": { "A": {...}, "B": {...}, "C": {...} },
  "baseline": "A"
}
```

---

## API surface

Every non-auth route requires `Authorization: Bearer <token>` plus an active
FMG instance bound to the session via `POST /api/auth/connect-fmg`.

### Auth
| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/register` | Create the first/any user |
| `POST` | `/api/auth/login` | Username + password → JWT |
| `POST` | `/api/auth/logout` | Drop session |
| `GET`  | `/api/auth/verify` | Whoami |
| `POST` | `/api/auth/connect-fmg` | Bind an FMG instance to the session |
| `GET`  | `/api/auth/setup-required` | True if no users exist yet |

### FMG instances & profiles
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/settings/fmg-instances` | List configured FMG instances |
| `POST` / `PUT` / `DELETE` | `/api/settings/fmg-instances[/{id}]` | CRUD |
| `GET` | `/api/profiles/types` | Profile type list |
| `GET` | `/api/profiles/{type}` | Profile name list |
| `GET` | `/api/profiles/{type}/{name}` | Full raw profile |
| `GET` | `/api/profiles/{type}/compare?name=A&name=B[&baseline=A]` | Flat + structured comparison |
| `GET` / `POST` | `/api/profiles/{type}/pins` | Pinned field paths |
| `GET` | `/api/schemas/profile/{type}` | FMG syntax schema for a profile type |
| `POST` | `/api/schemas/invalidate` | Clear the schema cache |

### Reference catalogs
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/reference/application-signatures` | Full app sig catalog |
| `GET` | `/api/reference/application-signatures/{id}/encyclopedia` | FortiGuard encyclopedia record (via CGI) |
| `GET` | `/api/reference/ips-signatures` | Full IPS sig catalog |
| `GET` | `/api/reference/ips-signatures/{id}/encyclopedia` | FortiGuard encyclopedia record (via CGI) |
| `GET` | `/api/reference/dlp-sensors` | DLP sensor catalog |
| `GET` | `/api/reference/dlp-dictionaries` | DLP dictionary catalog |
| `GET` | `/api/reference/dlp-data-types` | DLP data-type catalog |
| `GET` | `/api/reference/local-web-categories` | Custom web category catalog |
| `GET` | `/api/reference/web-rating-overrides` | FortiGuard URL override catalog |
| `GET` | `/api/reference/metadata-variables[?refresh=true]` | Metadata variables pivoted into device rows |

### Chat & AI providers (optional)
| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/chat/message` | SSE chat stream with page context and best-effort RAG |
| `POST` | `/api/chat/new` | Start an in-memory chat session |
| `POST` | `/api/chat/save` | Persist the current chat session |
| `GET` | `/api/chat/history` | List saved sessions for the user |
| `GET` | `/api/chat/history/{session_id}` | Load one saved session |
| `GET` / `POST` | `/api/ai/providers` | List or upsert provider definitions |
| `DELETE` | `/api/ai/providers/{provider_id}` | Delete a provider |
| `POST` | `/api/ai/providers/{provider_id}/test` | Smoke-test one provider |
| `POST` | `/api/ai/fetch-models` | Discover models for Ollama, OpenAI-compatible, or Gemini |
| `GET` | `/api/ai/ollama-models` | Legacy Ollama model discovery helper |

### Tools
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/tools/pan-xml/parsers` | List available PAN extractors |
| `POST` | `/api/tools/pan-xml/extract` | Multipart upload → enqueues a `pan_extract` job |
| `GET` | `/api/tools/diff/limits` | Upload caps + allowed extensions |
| `POST` | `/api/tools/diff/compare` | Multi-file diff (stateless) |
| `GET` | `/api/tools/object-migration/families` | Supported migrated-object families |
| `POST` | `/api/tools/object-migration/compare` | Compare FortiConverter/FortiGate object CLI against active FMG ADOM objects |
| `POST` | `/api/tools/object-migration/export` | Full JSON/CSV object comparison export |
| `GET` | `/api/tools/jinja-lab/reference` | FortiManager Jinja variable/filter reference |
| `GET` | `/api/tools/jinja-lab/devices` | Device database + metadata context for rendering |
| `GET` / `POST` / `DELETE` | `/api/tools/jinja-lab/templates[/{id}]` | Local template copies and imported FMG scripts/templates |
| `GET` / `POST` / `DELETE` | `/api/tools/jinja-lab/groups[/{group_id}]` | Local template groups |
| `POST` | `/api/tools/jinja-lab/render` | Render one template or template group against a device context |
| `GET` | `/api/tools/routes/devices` | Managed FortiGates available for route-table proxy |
| `POST` | `/api/tools/routes/query` | Collect IPv4 route tables from selected FortiGates via FMG proxy |
| `GET` | `/api/tools/policy-viewer/packages` | Policy package list |
| `GET` | `/api/tools/policy-viewer/schema` | Firewall policy schema |
| `GET` | `/api/tools/policy-viewer/packages/{pkg}/policies` | Policy entries |
| `GET` | `/api/tools/policy-viewer/packages/{pkg}/hitcount` | Live hit counters |
| `GET` | `/api/tools/policy-viewer/objects` | Firewall object map |
| `GET` | `/api/tools/policy-shadow/packages` | Shared with policy viewer |
| `POST` | `/api/tools/policy-shadow/run` | Enqueue shadow analysis job |
| `GET` | `/api/tools/isdb/devices` | Managed FortiGates available for proxy |
| `GET` | `/api/tools/isdb/fqdn` | ISDB FQDN catalog (via FOS proxy) |
| `GET` | `/api/tools/isdb/catalog` | ISDB service catalog (via FOS proxy) |
| `POST` | `/api/tools/isdb/service-details` | On-demand ISDB service details |
| `POST` | `/api/tools/isdb/lookup` | IP / FQDN enrichment (via FOS proxy) |
| `GET` | `/api/jobs/{job_id}` | Job status + result |
| `GET` | `/api/jobs/{job_id}/artifact/{filename}` | Per-job artifact download |

---

## Persistence

Backend state lives next to the backend (all gitignored):

- `backend/user_store.json` — bcrypt user records
- `backend/pin_store.json` — `{ profile_type: [field_path, ...] }`
- `backend/fmg_instances.json` — FMG credentials encrypted with Fernet
- `backend/ai_providers.json` — optional AI provider definitions; API keys
  are encrypted with the same Fernet key
- `backend/.fmg_key` — the Fernet key (losing it bricks every stored instance)
- `backend/chat_history/<username>/` — explicitly saved AI chat sessions
- `backend/user_data/<username>/jobs/<job_id>/` — per-user tool job outputs
  (parser CSVs/XLSX, bundled zip). Uploads land in
  `backend/user_data/<username>/uploads/` and are deleted as soon as the job
  finishes.

Frontend state lives in `localStorage`:

| Key pattern | Purpose |
|-------------|---------|
| `fmg_token` | JWT bearer token |
| `fieldvis:comparison:<type>` | Hidden leaf fields per profile-type page |
| `fieldvis:scc:<collectionKey>` | Hidden columns per structured collection |
| `fieldvis:ref:<kind>` | Hidden columns per reference page |
| `colorder:ref:<kind>` | Column order per reference page |
| `sort:ref:<kind>` | Sort column/direction per reference page |
| `refcols-init:ref:<kind>` | Default-columns migration sentinel (version-gated) |
| `baseline:<type>` | Persisted comparison baseline per profile type |
| `isdb:selected-device` | Last-used FortiGate for ISDB proxy |
| `chat:provider` | Last-selected AI provider |
| `chat:width`, `chat:height` | Resized chat widget dimensions |

---

## Quick start

Prereqs: **Python 3.12+**, **Node 18+**, a FortiManager with JSON-RPC API
access, and Docker/Podman for Redis (required by any `/tools` feature that
queues jobs — currently PAN extract and policy shadow).

```bash
# Redis (only required for tool jobs)
./scripts/start-redis.sh

# Backend API
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# ARQ worker (separate shell — required for tool jobs)
cd backend
venv/bin/arq app.jobs.worker.WorkerSettings

# Frontend (separate shell)
cd frontend
npm install
npm run dev -- --port 3002
```

Open <http://localhost:3002>, register the first user, then add an FMG
instance under **Settings** and connect to it. Profile comparison works
immediately; ISDB lookups and the route viewer additionally require at least
one FMG-managed FortiGate reachable through FortiManager proxy.

### Optional: AI provider setup

The app only needs an AI provider when you want to use the floating chat
assistant. Configure providers in **Settings → AI Providers**:

1. Pick a provider preset: **Ollama (Local)**, **OpenAI**, **Anthropic**,
   **Google Gemini**, **OpenRouter**, **FortiAIGate**, **vLLM**, or
   **Custom (OpenAI-compatible)**.
2. Enter the base URL, API key when required, model name, temperature, and
   token cap. Provider API keys are encrypted in `backend/ai_providers.json`.
3. Use **Fetch models** when the endpoint supports discovery, then **Test**
   before selecting the provider for chat.

For custom/self-hosted endpoints, use the OpenAI-compatible shape. The base URL
should be the API root, for example `http://127.0.0.1:8080/v1` or
`http://127.0.0.1:8000/v1`; the backend appends `/chat/completions` for chat
and `/models` for discovery.

### Optional: RAG pipeline setup

RAG is only used to enrich AI chat with Fortinet documentation excerpts. The
web app does not ingest documents itself; it expects a Qdrant collection that
was already populated by an external ingestion job using the same embedding
model and vector size.

Default retrieval settings:

```bash
export RAG_ENABLED=true
export RAG_QDRANT_URL=http://127.0.0.1:6333
export RAG_OLLAMA_URL=http://127.0.0.1:11434
export RAG_COLLECTION=fortinet_docs
export RAG_EMBEDDING_MODEL=qwen3-embedding:8b
export RAG_EMBEDDING_DIM=4096
export RAG_TOP_K=5
export RAG_MAX_CONTEXT_CHARS=7000
```

Minimal local serving stack:

```bash
ollama pull qwen3-embedding:8b
ollama serve

podman run -d --name qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant
```

Then run the ingestion job for your documentation corpus so Qdrant contains a
`fortinet_docs` collection with `4096`-dimension vectors from
`qwen3-embedding:8b`. If you use the companion Fortinet RAG pipeline, configure
that runner to the same `QDRANT_URL`, collection, embedding model, and
dimension before ingesting.

Quick sanity checks:

```bash
curl http://127.0.0.1:11434/api/tags
curl http://127.0.0.1:6333/collections/fortinet_docs
```

If `RAG_ENABLED=false`, or if Ollama/Qdrant is unreachable, chat still works
with the configured LLM provider. The rest of the application does not depend
on the AI provider or RAG stack at all.

---

## License

MIT
