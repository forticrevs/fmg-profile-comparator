# Conversion Tools Audit: Palo Alto → Fortinet Migration Scripts

**Generated:** 2025-04-09  
**Scope:** `/home/kali/fortinet-ai/docs/automation-scripts/config-parsing-conversion-tools/`  
**Total Scripts Analyzed:** 34 (across 6 subdirectories + root level)

---

## Executive Summary

This audit catalogs **34 Python scripts** organized into **8 functional categories**, developed to support complex Palo Alto Networks → Fortinet migration workflows. The scripts fall into four broad tiers:

1. **XML/Config Parsers** (8 scripts) – Pure file-in/file-out converters for PAN XML → CSV/Excel
2. **FortiManager API integrators** (8 scripts) – Live API calls to FMG for object fetch, update, cross-check
3. **FortiGate API mutators** (2 scripts) – Delete policies from FGT via live API (high-risk mutations)
4. **Search/Match utilities** (5 scripts) – Fuzzy-matching, database search, application signature alignment
5. **Support/utility** (11 scripts) – Config normalization, name trimming, building policy order, diffing

**Porting Landscape:**
- **Easy ports:** 12 scripts (pure file I/O, no external APIs)
- **Medium complexity:** 10 scripts (uploads + async/batch processing, may require job queuing)
- **Hard/Live API:** 8 scripts (require FMG/FGT credentials; can reuse app's existing FMG auth layer)
- **Not recommended:** 4 scripts (deprecated, incomplete, or too specialized for web)

---

## Table of Contents

1. [Overview](#overview)
2. [Dependency Graph](#dependency-graph)
3. [Per-Script Entries](#per-script-entries)
   - [Category 1: PAN XML Parsers](#category-1-pan-xml-parsers)
   - [Category 2: FMG Fetchers & Persistence](#category-2-fmg-fetchers--persistence)
   - [Category 3: FGT API Mutators](#category-3-fgt-api-mutators)
   - [Category 4: Database & Search](#category-4-database--search)
   - [Category 5: Config Transformers](#category-5-config-transformers)
   - [Category 6: Matching & Comparison](#category-6-matching--comparison)
   - [Category 7: Utility & Reference](#category-7-utility--reference)
   - [Category 8: Deprecated/Incomplete](#category-8-deprecatedincomplete)
4. [Web-Port Priority List](#web-port-priority-list)
5. [Open Questions](#open-questions)

---

## Overview

### Script Distribution

| Category | Count | Subdirs | State |
|----------|-------|---------|-------|
| PAN XML Parsers | 8 | root | Stable |
| FMG Fetchers | 3 | root | Stable |
| FGT Mutators | 2 | root | Stable (destructive!) |
| Config Transformers | 5 | root | Stable |
| Comparators | 2 | fmg_object_compare/ | Working; placeholder credentials |
| Database Search | 2 | db_search/ | Stable |
| Fuzzy Match | 1 | fuzzy_match/ | Stable |
| Application Matching | 2 | app_match_tool_gpu/ | Advanced (GPU, LLM, Faiss) |
| FortiGuard Rating | 1 | fortiguard_rating/ | Stub; needs API token |
| Apps to Excel | 1 | ftnt_apps_to_excel/ | Simple JSON→XLSX |
| Other | 7 | root | Mix of working + deprecated |

### High-Level Categories

**A. Read-Only, File-In/File-Out (Safe for Web)**
- All XML parsers (8)
- Fuzzy match (1)
- Trim overlength names (1)
- Normalize policies (1)
- Database search (2)
- **Total: 13 scripts** – low web-port risk

**B. API Read-Only (Requires FMG Creds, No Mutation)**
- FMG fetch objects (1)
- FMG fetch URL filters (1)
- FMG URL crosscheck (1)
- FMG export SSL exempt (1)
- FMG get policies (1)
- **Total: 5 scripts** – medium web-port risk (need auth)

**C. API Mutation (Dangerous; Requires Careful Design)**
- FGT delete duplicate policies from config (1)
- FGT delete non-INET policies (1)
- FMG set scope from CSV (1)
- **Total: 3 scripts** – high web-port risk (live deletions)

**D. Advanced/Specialized (GPU, ML, 3rd-party APIs)**
- Application matching w/ GPU/Faiss/GPT (2)
- FortiGuard API rating (1)
- **Total: 3 scripts** – complex dependencies

**E. Deprecated/Incomplete**
- FMG build global order (1) – "doesn't work as intended"
- Parse FMG ADOM export (1) – simple cleanup, rarely used
- FTN match app IDs (1) – incomplete stub
- Shared rules analyzer (1) – utility
- **Total: 4 scripts** – lower priority

---

## Dependency Graph

### Sqlite DB Lifecycle

```
fmg_fetch_objects.py          ─────────┐
fmg_fetch_url_filters.py      ─────────┼─→ fmg_addresses.db
fmg_export_ssl_exempt.py      ─────────┘

       ↓ (reads/searches)

db_search.py
db_search_local_cat.py        ─────→ Searches all text columns
```

### Configuration Build Pipeline

```
.merged-running-config.xml (PAN export)
       ↓
xml_ssldecryption_to_csv.py           ─→ SSL decryption rules CSV
xml_to_csv_custom_url_categories.py   ─→ URL categories CSV
xml_parse_profile_groups.py           ─→ Profile group CSV
xml_parse_app_groups.py               ─→ Application groups Excel
xml_to_csv_rule_reporter.py           ─→ Security rules CSV
xml_url_filter_to_excel.py            ─→ URL filter profiles Excel
xml_convert_wildard_objects_to_ftnt.py ─→ Wildcard address config

       ↓ (FortiConverter produces)

config-all_policies_objects.txt
       ↓
ftnt_trim_overlength_names.py         ─→ Trimmed + deduped config + CSV map
       ↓
post-fcon-normalizer.py               ─→ Normalized policies config
       ↓
fgt_delete_duplicate_inet_from_config.py ─→ Cleaned config (FGT API call)
       ↓
fgt_delete_non_inet_policies.py       ─→ Delete from FGT staging (FGT API call)
```

### FortiManager Integration

```
fmg_fetch_objects.py
    ├─ Populates: address_ipmask, address_iprange, address_fqdn, 
    │              address_wildcard, address_geography, address_mac,
    │              addrgrp, local_cat, local_rating,
    │              wildcard_fqdn_custom, wildcard_fqdn_group
    │
fmg_fetch_url_filters.py
    ├─ Populates: url_filters table
    │
fmg_url_crosscheck.py
    ├─ Reads: custom_url_categories.csv
    ├─ Calls: FMG address, wildcard-fqdn, local-cat, local-rating APIs
    └─ Outputs: url_crosscheck_output.csv (no mutations)
    │
fmg_set_scope_from_csv.py
    ├─ Reads: CSV with shared_rule_name, unique_rule_name + device lists
    └─ Issues FMG "update" calls to set scope members (MUTATES FMG)
```

### Application Matching Pipeline

```
fortinet_apps.csv  ─┐
paloalto_apps.csv  ─┼─→ app_match.py (GPU / Faiss / LLM)
                   ↓
              matches.parquet ─→ export_results.py ─→ matches_full.csv
```

---

## Per-Script Entries

### Category 1: PAN XML Parsers

#### 1. **xml_ssldecryption_to_csv.py**

**What it does:**
Parses Palo Alto merged-running-config.xml and extracts SSL decryption rule entries from `/config/devices/.../rulebase/decryption/rules/`. For each `<entry>`, captures category, service, type (e.g., ssl-forward-proxy), from/to zones, source/dest, source-user, description, action, disabled flag, and profile. Writes flat CSV with 12 columns in a fixed order.

**Inputs:**
- File: PAN XML configuration (typically `.merged-running-config.xml`)
- CLI args: `<input_xml> <output_csv>`

**Outputs:**
- File: CSV with columns [category, service, type, from, to, source, destination, source-user, description, action, disabled, profile]
- Count: One row per SSL decryption rule entry

**External Dependencies:**
- Python stdlib: xml.etree.ElementTree, csv, argparse, logging

**State/Persistence:**
None. Pure transformation, no DB or file side effects.

**Side-Effect Risk:**
Read-only. Safe.

**Web-Port Assessment:** **Easy** – Pure file in/out, no external calls. Ideal for "Upload PAN XML → Download SSL Decryption CSV" web form.

---

#### 2. **xml_to_csv_custom_url_categories.py**

**What it does:**
Parses PAN XML for custom URL category entries under `<custom-url-category>` and generates CSV with columns [entry name, urls, type, description]. For each category, iterates its `<list><member>` children to produce one CSV row per URL (so a category with N URLs produces N rows).

**Inputs:**
- File: PAN XML
- CLI args: `<input_xml> <output_csv>`

**Outputs:**
- File: CSV with columns [entry name, urls, type, description] (one row per URL within each category)

**External Dependencies:**
- Python stdlib: xml.etree.ElementTree, csv, argparse

**State/Persistence:**
None.

**Side-Effect Risk:**
Read-only. Safe.

**Web-Port Assessment:** **Easy** – Pure XML → CSV. Can be bundled with other PAN XML parsers in a single "PAN XML Extraction Suite" UI.

---

#### 3. **xml_parse_profile_groups.py**

**What it does:**
Parses PAN XML for `<profile-group>` entries under `/devices/.../vsys/.../profile-group/`. For each entry, extracts the first `<member>` under each security profile type section (virus, spyware, vulnerability, file-blocking, wildfire-analysis, url-filtering). Outputs CSV with columns [entry name, virus, spyware, vulnerability, file-blocking, wildfire-analysis, url-filtering].

**Inputs:**
- File: PAN XML
- CLI args: `<input_xml> <output_csv>`

**Outputs:**
- File: CSV (one row per profile-group entry)

**External Dependencies:**
- Python stdlib: xml.etree.ElementTree, csv, argparse

**State/Persistence:**
None.

**Side-Effect Risk:**
Read-only. Safe.

**Web-Port Assessment:** **Easy** – Pure XML → CSV.

---

#### 4. **xml_parse_app_groups.py**

**What it does:**
Parses PAN XML for application-group entries and outputs an Excel workbook where each sheet is a group name and columns are the member application names (one member per column, rows padded with blanks if group sizes differ). Uses openpyxl.Workbook to write.

**Inputs:**
- File: PAN XML
- CLI args: `<input_xml>` (with optional `--output` for Excel filename)
- Uses automatic naming: `<input_basename>_application-group.xlsx`

**Outputs:**
- File: Excel workbook (one sheet per application-group)

**External Dependencies:**
- openpyxl (write-only)
- Python stdlib: xml.etree.ElementTree, argparse, os

**State/Persistence:**
None.

**Side-Effect Risk:**
Read-only.

**Web-Port Assessment:** **Easy** – Pure XML → Excel.

---

#### 5. **xml_to_csv_rule_reporter.py**

**What it does:**
Parses PAN XML security rules (under `/devices/.../rulebase/security/rules/`) and extracts each rule's name along with all members under profile-setting, source-user, source, destination, category, application, tag. Outputs CSV with columns [rule_name, profile_settings, source_users, sources, destinations, categories, applications, tags] (members joined by semicolon).

**Inputs:**
- File: PAN XML
- CLI args: `<input_xml> <output_csv>`

**Outputs:**
- File: CSV with 8 columns

**External Dependencies:**
- Python stdlib: xml.etree.ElementTree, csv, argparse

**State/Persistence:**
None.

**Side-Effect Risk:**
Read-only. Safe.

**Web-Port Assessment:** **Easy** – Pure XML → CSV.

---

#### 6. **xml_url_filter_to_excel.py**

**What it does:**
Parses PAN XML URL-filtering profiles and generates three Excel workbooks:
1. `<input>_urlf.xlsx` – one sheet per profile with "Alert Categories" and "Block Categories" columns
2. `<input>_allcats.xlsx` – one sheet "AllCategories" with columns [URL Category, Profiles] (semicolon-separated list of profile names per category)
3. `inet_categories.xlsx` – filtered to only four specific INET profile names, with "Profile 1", "Profile 2", etc. columns

Uses pandas.ExcelWriter and custom logic to match profiles to categories.

**Inputs:**
- File: PAN XML
- CLI args: `<xml>` (with optional `--out`, `--cats`, `--inet` for output filenames)

**Outputs:**
- Files: Three Excel workbooks (or configurable names)

**External Dependencies:**
- pandas (dataframe operations)
- openpyxl (engine for ExcelWriter)
- Python stdlib: xml.etree.ElementTree, argparse, pathlib, collections

**State/Persistence:**
None.

**Side-Effect Risk:**
Read-only.

**Web-Port Assessment:** **Easy** – Pure XML → Excel. Complex output logic but no external APIs.

---

#### 7. **xml_convert_wildard_objects_to_ftnt.py**

**What it does:**
Converts PAN wildcard address objects (format: `ip/mask` where mask uses PAN's special byte rounding) to Fortinet wildcard format (complement logic). For each `<address><ip-wildcard>` entry in PAN XML, rounds each PAN mask byte up to next power-of-two (e.g., 33 → 63), then applies Fortinet complement (255 - rounded). Aligns IP octet down to block boundary. Outputs CLI config blocks (`config firewall address / edit / set type wildcard / set wildcard IP MASK / next`).

**Inputs:**
- File: PAN XML configuration
- CLI args: `<pan_xml>` (with optional `--out` for output file, default stdout)

**Outputs:**
- File: FortiGate-compatible config text (not a full config, just address blocks)

**External Dependencies:**
- Python stdlib: argparse, xml.etree.ElementTree, pathlib

**State/Persistence:**
None.

**Side-Effect Risk:**
Read-only.

**Web-Port Assessment:** **Easy** – Pure XML → text config. Could produce downloadable `.conf` snippet.

---

#### 8. **pan_analyze_ssl_decrypt_diffs.py**

**What it does:**
Finds all CSV files in current directory matching `*ssl_decrypt_rules*.csv` (typically output from `xml_ssldecryption_to_csv.py` run on multiple PAN firewalls). For each CSV, loads all rows and builds a map of unique rule tuples to the filenames they appear in. Outputs merged CSV with an extra "files" column listing source filenames (semicolon-separated). Also logs distribution: how many rules appear in 1 file, 2 files, etc.

**Inputs:**
- Files: Multiple `*ssl_decrypt_rules*.csv` in working directory
- CLI args: optional `--output` (default `ssl_decrypt_rules_merged.csv`)

**Outputs:**
- File: Merged CSV with original columns + "files"

**External Dependencies:**
- Python stdlib: csv, glob, logging, pathlib, collections

**State/Persistence:**
None (but relies on specific file naming convention in cwd).

**Side-Effect Risk:**
Read-only. Good for understanding shared rules across multiple PAN deployments.

**Web-Port Assessment:** **Easy** – Pure file merge. However, requires user to upload multiple CSV files and typically used for ad-hoc comparison rather than a standard workflow.

---

### Category 2: FMG Fetchers & Persistence

#### 9. **fmg_fetch_objects.py**

**What it does:**
Logs into FortiManager via JSON-RPC (sys/login/user), then fetches all firewall address objects (ipmask, iprange, fqdn, wildcard, geography, mac), address groups, local webfilter categories, local webfilter rating overrides, and wildcard-FQDN (custom & group). For each object type, filters by type field and inserts into an SQLite database with dedicated tables. Creates/replaces DB on each run.

**Inputs:**
- CLI args: `--fmg FMG_IP` (or prompt), `--adom ADOM_NAME`, `--db DB_FILE` (default `fmg_addresses.db`)
- Interactive: Prompts for FMG username and password (no env var support)

**Outputs:**
- SQLite DB: Tables for each address type + local_cat, local_rating, wildcard_fqdn_custom/group (11 tables total)
- Side effect: Overwrites existing DB (no append, always fresh)

**Outputs Schema:**
```
address_ipmask(name TEXT PK, color INT, subnet TEXT)
address_iprange(name TEXT PK, color INT, start_ip TEXT, end_ip TEXT)
address_fqdn(name TEXT PK, color INT, fqdn TEXT)
address_wildcard(name TEXT PK, color INT, wildcard TEXT)
address_geography(name TEXT PK, color INT)
address_mac(name TEXT PK, color INT, mac TEXT)
addrgrp(name TEXT PK, color INT, members TEXT)
local_cat(id INT PK, desc TEXT, status INT)
local_rating(oid INT PK, url TEXT, status TEXT, rating TEXT)
wildcard_fqdn_custom(oid INT PK, name TEXT, uuid TEXT, wildcard_fqdn TEXT)
wildcard_fqdn_group(oid INT PK, name TEXT, members TEXT)
```

**External Dependencies:**
- requests (FMG JSON-RPC)
- urllib3 (suppress SSL warnings)
- sqlite3 (stdlib)

**State/Persistence:**
- **Writes SQLite DB** – critical dependency for db_search, fmg_url_crosscheck, etc.
- No idempotency: each run **overwrites** DB

**Side-Effect Risk:**
- Read-only on FMG side (GET calls only)
- **Destructive on local filesystem**: deletes and recreates DB every time
- Does not require credentials stored in env (prompts at runtime)

**Web-Port Assessment:** **Medium** – Needs FMG credentials and interactive password prompt. Could be refactored for web (accept creds in form, store securely), but requires careful handling of sensitive data. Best as async background job.

---

#### 10. **fmg_fetch_url_filters.py**

**What it does:**
Similar to `fmg_fetch_objects.py`, but fetches URL filter objects from `/pm/config/adom/{adom}/obj/webfilter/urlfilter`. For each URL filter definition, iterates its `entries` array and extracts (url, type, action, status) for each entry. Writes to CSV with columns [url, type, action, status, url-filter-name] and also inserts into SQLite `url_filters` table.

**Inputs:**
- CLI args: `--fmg`, `--adom`, `--user`, `--db`, `--out` (all with defaults)
- Default FMG host, ADOM, and user baked into the script (e.g. ADOM `ACME1`, user `admin`) — these will be replaced with the app's existing FMG session when ported

**Outputs:**
- CSV file (default `url_filters.csv`)
- SQLite DB: `url_filters` table (default `fmg_addresses.db`)

**Outputs Schema:**
```
url_filters(url TEXT, type TEXT, action TEXT, status TEXT, url_filter_name TEXT)
```

**External Dependencies:**
- requests, urllib3, sqlite3, csv, argparse, getpass

**State/Persistence:**
- **Writes CSV + SQLite** – appends/replaces in DB
- Hard-coded defaults (FMG IP, ADOM) – user should override

**Side-Effect Risk:**
- Read-only on FMG
- Overwrites local CSV and DB entries
- Has hard-coded credentials in comments (security concern for example)

**Web-Port Assessment:** **Medium** – Similar to fmg_fetch_objects. Requires FMG creds and produces two outputs. Good as async job.

---

#### 11. **fmg_export_ssl_exempt.py**

**What it does:**
Logs into FMG, fetches the ssl-exempt members list from a given SSL-SSH profile (e.g., "SSL-Deep-Inspection"). The ssl-exempt list contains entries with nested address, wildcard-fqdn, and fortiguard-category values. For each entry, extracts member_id, oid, type, and iterates the values array to insert one row per exempt item into a new `ssl_exempt` table in SQLite.

**Inputs:**
- CLI args: `--fmg`, `--adom`, `--user`, `--profile`, `--db`
- Defaults baked in: FMG host, ADOM (e.g. `ACME1`), user `admin`, SSL profile `SSL-Deep-Inspection`, DB `fmg_addresses.db` — host/ADOM/user will be replaced with the app's FMG session + per-user DB when ported

**Outputs:**
- SQLite DB: `ssl_exempt` table (created fresh each run)

**Outputs Schema:**
```
ssl_exempt(profile TEXT, member_id INT, oid INT, type TEXT, value TEXT)
```

**External Dependencies:**
- requests, urllib3, sqlite3, argparse, getpass

**State/Persistence:**
- **Writes to SQLite** – replaces table on each run

**Side-Effect Risk:**
- Read-only on FMG
- Overwrites local SSL exempt table

**Web-Port Assessment:** **Medium** – Needs FMG auth. Would require selecting profile name from dropdown or text input. Good for async job.

---

### Category 3: FGT API Mutators

#### 12. **fgt_delete_duplicate_inet_from_config.py**

**What it does:**
Polls FortiGate API for all policy names (`GET /api/v2/cmdb/firewall/policy?format=name`), extracts 33-char prefixes. Reads input config file and scans for `config firewall policy` blocks. For each policy block with a `set name` line, checks if its 33-char prefix matches any FGT prefix. If match found, **omits entire policy block from output**. Otherwise preserves it. Logs all removals to file.

**Inputs:**
- File: FortiGate configuration text
- Environment: `FGT_TOKEN` (API token)
- CLI args: `--in <config>`, `--out <cleaned_config>`, `--fgt <IP>`, `--log <logfile>`

**Outputs:**
- File: Cleaned config (with duplicate policies removed)
- File: Log of removals and actions

**External Dependencies:**
- requests (FortiGate REST API)
- urllib3, re, logging, argparse

**State/Persistence:**
- **Reads from FGT API** – polls live FortiGate
- **Writes modified config file** – destructive edit to remove policies

**Side-Effect Risk:**
- **High risk**: Reads from live FGT; filtering logic is 33-char prefix match (fragile)
- No dry-run mode; output is immediate
- Logs actions but no rollback capability

**Web-Port Assessment:** **Hard** – Requires FGT token (secure storage). User uploads config, system calls FGT API, returns cleaned config. Needs:
- Token management (encrypted storage or session-based)
- Dry-run preview before applying
- Audit logging of what would be removed
- Clear user consent ("Are you sure?" modal)

---

#### 13. **fgt_delete_non_inet_policies.py**

**What it does:**
Loads a CSV with a `rule_name` column. Extracts 33-char prefixes from each rule name. Polls FGT API for all policies (name + policyid). For each FGT policy whose 33-char prefix **does not** appear in the CSV prefix set, marks it for deletion. Lists policies to delete and prompts user for confirmation (y/N). If confirmed, issues DELETE requests to FGT API for each policy.

**Inputs:**
- CSV file: Column `rule_name` (policies to keep)
- Environment: `FGT_TOKEN`
- CLI args: `--csv <file>`, `--fgt <IP>`, `--log <logfile>`

**Outputs:**
- File: Log of deleted policies and errors

**External Dependencies:**
- requests, urllib3, csv, logging, argparse

**State/Persistence:**
- **Mutates FortiGate via DELETE API calls**
- No transaction, no rollback
- Logs but cannot undo

**Side-Effect Risk:**
- **Very high risk**: Performs destructive DELETE operations on live FortiGate
- User confirmation is only protection (can be easily clicked through)
- Prefix-matching logic may delete unintended policies
- No dry-run mode

**Web-Port Assessment:** **Hard / Not Recommended** – This is a dangerous operation that should **not** be automated in a web UI without:
1. Dry-run preview with exact list of policies to delete
2. Staged deletion (delete one at a time, confirming each)
3. Backup of FGT before operation
4. Audit trail of who authorized the deletion and when
5. Possible RBAC restrictions (only admins can perform)

If ported, **must** be sandboxed and gated behind multiple confirmations.

---

#### 14. **fmg_set_scope_from_csv.py**

**What it does:**
Logs into FMG, fetches all policies from a package (`/pm/config/adom/{adom}/pkg/{pkg}/firewall/policy` with fields name + policyid). Reads CSV with columns [shared_rule_name, shared_rule_devices, unique_rule_name, unique_rule_devices]. For each row:
- If shared_rule_name matches a FMG policy (prefix match on 32 chars), issue FMG UPDATE to set `scope member` = split(shared_rule_devices, ';')
- If unique_rule_name matches, update scope to single device

**Inputs:**
- CSV file: Columns [shared_rule_name, shared_rule_devices, unique_rule_name, unique_rule_devices]
- Interactive prompts: FMG IP, Username, Password, ADOM, CSV filename, Package name

**Outputs:**
- Side effect: Updates FMG policy objects via JSON-RPC `update` calls

**External Dependencies:**
- requests, urllib3, csv, argparse, getpass

**State/Persistence:**
- **Mutates FortiManager** – issues UPDATE calls to set policy scope

**Side-Effect Risk:**
- Medium risk: Modifying policy scope is less destructive than deletion, but still alters FMG config
- No confirmation before updates
- No rollback

**Web-Port Assessment:** **Medium/Hard** – Updating FMG scopes is a normal operation, but:
1. Requires FMG credentials
2. Should preview changes before applying
3. Could be async job with audit trail
4. Better as part of policy management UI rather than standalone

---

### Category 4: Database & Search

#### 15. **db_search/db_search.py**

**What it does:**
Reads a CSV with search terms in the first column. Connects to SQLite DB (default `fmg_addresses.db`), enumerates all tables and finds text-type columns (CHAR, CLOB, TEXT). For each search term, issues `LIKE` queries on every text column. For each match, writes [term, table, column, rowid, match_value] to output CSV. If no matches found for a term, writes one row with empty table/column/rowid/value to indicate "no match".

**Inputs:**
- CSV file: First column = search terms
- SQLite DB: (default `fmg_addresses.db`)
- CLI args: `--db <db_file>`, `--csv <terms_csv>`, `--out <results_csv>`

**Outputs:**
- CSV file: [term, table, column, rowid, match_value]

**External Dependencies:**
- sqlite3 (stdlib), csv, logging, argparse, pathlib

**State/Persistence:**
- Reads SQLite DB (assume pre-populated by fmg_fetch_objects)

**Side-Effect Risk:**
- Read-only on both DB and CSV

**Web-Port Assessment:** **Easy** – Pure file I/O + DB search. Could be:
- Paste-in form for search terms or upload CSV
- Returns downloadable CSV of matches
- No auth needed (but DB must be pre-seeded)

**Usage Workflow:**
- Prerequisite: `fmg_fetch_objects.py` must have run to populate DB
- User provides CSV of terms to find (e.g., IP addresses, names)
- System searches all FMG object attributes and returns matches

---

#### 16. **db_search/db_search_local_cat.py**

**What it does:**
Like `db_search.py`, but specialized for the `local_rating` table. Reads search terms from CSV (first column header should be "url" for sanitization, or anything else for literal matching). For each term, builds patterns:
- If header is "url": tries exact match, exact with path (`/`), wildcard subdomain (`*.domain`), and subdomain with path
- Otherwise: uses `LIKE %term%` (literal fuzzy match)

For each match in `local_rating.url`, extracts the `rating` IDs, joins with `local_cat.desc` to get category descriptions, and outputs [term, table, column, local_cat, match_value].

**Inputs:**
- CSV file: First column = search terms, optional header "url"
- SQLite DB: (default `fmg_addresses.db`)
- CLI args: `--db`, `--csv`, `--out`

**Outputs:**
- CSV: [term, table, column, local_cat, match_value]

**External Dependencies:**
- sqlite3, csv, logging, argparse, pathlib, re

**State/Persistence:**
- Reads SQLite DB

**Side-Effect Risk:**
- Read-only

**Web-Port Assessment:** **Easy** – Similar to db_search.py but with domain-boundary matching. Good for "Search URL categories by domain" web form.

---

### Category 5: Config Transformers

#### 17. **ftnt_trim_overlength_names.py**

**What it does:**
Two-pass algorithm to shorten over-length object and policy names in FortiGate config files while preserving uniqueness:

**Pass 1 (Collection):**
- Scans entire config, identifies all policy and object names in order (including duplicates)

**Pass 2 (Deduplication):**
- For each unique name:
  - If occurs once AND ≤ limit (policy 35 chars, objects 79 chars): keep as-is
  - If occurs once BUT > limit: truncate to (limit-1) chars, append "~"
  - If occurs multiple times: base = orig[:limit-2], suffix = "~1" / "~2" / ... / "~a"–"~z" (max 35 occurrences)
  - Append suffix to make final name ≤ limit

**Pass 3 (Replacement):**
- Re-streams the config, replacing each occurrence of original name with queued replacement
- Handles both "edit" lines and inline references in policy/group/service blocks

**Outputs:**
- Cleaned config file
- CSV name map with [old_name, new_name] in order of appearance

**Inputs:**
- File: FortiGate configuration
- CLI args: `<config>`, `--out <cleaned.conf>`, `--csv <map.csv>`

**Outputs:**
- File: Cleaned config (stdout if --out not specified)
- File: CSV mapping (default `name_map.csv`)

**External Dependencies:**
- re, csv, logging, argparse, pathlib, collections, string

**State/Persistence:**
- None

**Side-Effect Risk:**
- Read-only on inputs; writes two output files

**Web-Port Assessment:** **Easy** – Pure file transformation. UI:
- Upload config file
- Download cleaned config + name map CSV
- Could show preview of changes (sample name mappings)

---

#### 18. **post-fcon-normalizer.py**

**What it does:**
Normalizes multi-line policy comment blocks in FortiGate configs. Within `config firewall policy` section:
- Removes any lines starting with '#' (inline warnings)
- Consolidates multi-line `set comments "..."` into single-line quoted strings (replaces internal newlines with spaces)
- Truncates comment to max 1023 characters

**Inputs:**
- File: FortiGate config
- CLI args: `--in <input.conf>` (required), `--out <output.conf>` (required)

**Outputs:**
- File: Normalized config

**External Dependencies:**
- re, argparse, sys

**State/Persistence:**
- None

**Side-Effect Risk:**
- Read-only on inputs; writes output file

**Web-Port Assessment:** **Easy** – Pure text transformation. Could be combined with `ftnt_trim_overlength_names.py` as part of a "Config Cleanup Suite".

---

#### 19. **parse_fmg_adom_export.py**

**What it does:**
Strips out `config dynamic_mapping` blocks and any `set _scope` lines from a FortiManager ADOM export text file. Useful for cleaning exports before re-importing (dynamic scopes shouldn't be re-imported as they're generated by FMG).

**Inputs:**
- File: ADOM export text
- CLI args: `<input> <output>`

**Outputs:**
- File: Cleaned export

**External Dependencies:**
- re, argparse, pathlib

**State/Persistence:**
- None

**Side-Effect Risk:**
- Read-only on inputs

**Web-Port Assessment:** **Easy** – Pure text filter. Rarely used; could be bundled with other cleanup tools.

---

#### 20. **ftnt_match_app_ids.py**

**What it does:**
Stub script. Reads a CSV `merge_ftnt_apps_into_corp_script.csv` with columns [master_application_list, application_id, observed_application]. Builds a map master → ID, then iterates rows again looking for matches where observed_application is in the master list, prints matched application IDs space-separated.

**Status:** **Incomplete** – Hardcoded input filename, no CLI args, not parameterizable.

**Inputs:**
- Hardcoded filename: `merge_ftnt_apps_into_corp_script.csv`

**Outputs:**
- stdout: Space-separated application IDs

**External Dependencies:**
- csv

**Web-Port Assessment:** **Skip** – Incomplete and poorly designed.

---

### Category 6: Matching & Comparison

#### 21. **fuzzy_match/fuzzy_match.py**

**What it does:**
Fuzzy-matches column A of two CSV files using RapidFuzz. For each value in CSV1's column A, finds the best-scoring match in CSV2's column A (using WRatio scorer by default, with optional cutoff threshold). Outputs CSV with [value1, best_match2, score].

**Inputs:**
- CSV files (two)
- CLI args: `<csv1> <csv2>` (positional), `--out <output.csv>`, `--threshold <0-100>`

**Outputs:**
- CSV: [value1, best_match2, score]

**External Dependencies:**
- rapidfuzz (process, fuzz module)
- csv, logging, argparse, pathlib

**State/Persistence:**
- None

**Side-Effect Risk:**
- Read-only

**Web-Port Assessment:** **Easy** – Pure file transformation. UI:
- Upload two CSVs
- Set threshold slider (default 0)
- Return downloadable matches CSV

**Example:** Fuzzy-match PAN app names to Fortinet app names.

---

#### 22. **app_match_tool_gpu/app_match.py**

**What it does:**
Advanced application signature matcher (Fortinet ↔ Palo Alto) using:
1. **String similarity** – token_sort_ratio on canonicalized names, category/subcategory exact match, partial ratio on tech, Jaccard distance on protocol/port sets
2. **Embedding similarity** – sentence-transformers all-mpnet-base-v2 model, cosine similarity on embeddings
3. **Faiss GPU search** (optional) – brute-force cosine search with CUDA acceleration
4. **LLM validation** (optional) – GPT-4o-mini asking "are these the same app?" for borderline cases
5. **Caching** – SQLite cache of LLM responses to avoid re-queries

Outputs parquet file of matches with score and method (str / emb / faiss / llm). Optional GraphML network file.

**Inputs:**
- CSV files: `--forti <fortinet_apps.csv>`, `--palo <paloalto_apps.csv>`
- Optional: `--openai-key <key>`, `--faiss`, `--no-gpt-ports` (skip port→protocol inference)
- Thresholds: `--high <0.75>`, `--gray <0.50>`, `--emb <0.80>`

**Outputs:**
- Parquet file: [fid, pid, score, method] (Fortinet app ID, Palo Alto app ID, match score, matching method)
- Optional GraphML: Network visualization of matches

**External Dependencies:**
- pandas, rapidfuzz, sentence-transformers (requires pytorch + huggingface), networkx, openpyxl
- **Optional:** faiss (GPU or CPU), openai (async), aiohttp
- **Large downloads:** Sentence transformer model (~400MB) downloads on first use

**State/Persistence:**
- Creates `.matcher_cache.sqlite` for LLM caching (SQLite)
- No external DB dependency

**Side-Effect Risk:**
- **Large GPU/CPU intensive** – embedding model requires CUDA or CPU fallback
- LLM calls cost money (GPT-4o-mini API) if OpenAI key provided
- Async operations with semaphore throttling (max 20 concurrent requests)
- Model download on first run

**Web-Port Assessment:** **Hard** – Advanced features requiring:
1. GPU support (optional but highly beneficial)
2. Sentence transformer model cache (large initial download)
3. OpenAI API key management if LLM features used
4. Async job queue (matching can take minutes)
5. Fallback logic if GPU unavailable (auto-switches to CPU)

**Recommendation:** Port as async background job with progress tracking. UI:
- Upload two CSVs
- Optional: provide OpenAI API key + enable LLM mode
- Optional: enable GPU mode (if server has CUDA)
- Start job, poll for completion
- Download parquet + optional GraphML

---

#### 23. **app_match_tool_gpu/export_results.py**

**What it does:**
Converts parquet match results back to CSV with full context. Reads `matches.parquet` and merges with the original Fortinet and Palo Alto CSVs (on fid/pid indices) to produce CSV with [fid, forti_name, pid, palo_name, score, method].

**Inputs:**
- Parquet: `--matches <matches.parquet>`
- CSVs: `--forti <fortinet_apps.csv>`, `--palo <paloalto_apps.csv>`
- Output: `--out <matches_full.csv>`

**Outputs:**
- CSV: Full details of matches

**External Dependencies:**
- pandas

**State/Persistence:**
- None

**Side-Effect Risk:**
- Read-only

**Web-Port Assessment:** **Easy** – Post-processing step. Could run automatically after `app_match.py` completes.

---

#### 24. **shared_rules.py**

**What it does:**
Analyzes rule overlap across multiple firewalls. Reads a CSV where first row = firewall names, subsequent rows = rule names per firewall (one column per firewall). Builds maps of shared rules (rules on ≥2 firewalls) and unique rules (on exactly 1 firewall). Outputs CSV with 4 columns: [Shared rule, Devices, Unique rule, Device].

**Inputs:**
- CSV file: First row = firewall names, columns = rule lists

**Outputs:**
- CSV: [Shared rule, Devices (semicolon-sep), Unique rule, Device]

**External Dependencies:**
- csv, argparse, collections

**State/Persistence:**
- None

**Side-Effect Risk:**
- Read-only

**Web-Port Assessment:** **Easy** – Pure data transformation. UI:
- Upload CSV
- Download analysis CSV

---

#### 25. **fmg_url_crosscheck.py**

**What it does:**
Cross-references a custom URL categories CSV against FortiManager objects. Reads CSV with columns [custom_url_category, url, used_in_inet_policy, used_in_inet_profile, description]. For each URL:
1. **Sanitizes:** Strips `http://`, `https://`, `*.`, trailing `/*`, port suffixes
2. **Classifies:** Determines if URL is ipmask (x.x.x.x/mask), fqdn (example.com), or wildcard-fqdn (*.example.com)
3. **Checks FMG:** Queries FMG for matching address objects, wildcard-FQDNs, local categories, and rating overrides
4. **Reports:** [custom_url_category, url, type, sanitised, needs_addr_obj, addr_obj_exists, needs_wc_obj, wc_obj_exists, needs_rating_ovr, rating_ovr_exists, rating_cat_id, rating_cat_name, comments]

**Inputs:**
- CSV file: Custom URL categories
- Interactive prompts: FMG IP, username, password, ADOM, CSV filename

**Outputs:**
- CSV: Detailed cross-check report (`url_crosscheck_output.csv`)

**External Dependencies:**
- requests, urllib3, re, csv, logging, pathlib

**State/Persistence:**
- Reads from FMG API (no FMG mutations)

**Side-Effect Risk:**
- Read-only on FMG
- Requires FMG credentials (interactive)

**Web-Port Assessment:** **Medium** – Requires FMG auth but only reads. Could be async job:
1. User uploads custom URL categories CSV
2. User provides FMG IP + credentials (or uses existing session from app's FMG layer)
3. System queries FMG and produces cross-check report
4. User downloads report

Good use case for reusing the app's existing FMG auth context.

---

#### 26. **pan_create_alert_block_table_url_profile_by_category.py**

**What it does:**
Reads an Excel workbook (output from `xml_url_filter_to_excel.py`) where each sheet is a URL-filter profile with "Alert Categories" and "Block Categories" columns. Produces a summary Excel file with one sheet "Summary" containing [URL Category, Alert Profiles, Block Profiles] where profiles are semicolon-separated lists of profile names that alert or block each category.

**Inputs:**
- Excel file (typically from `xml_url_filter_to_excel.py`)
- CLI args: `--in <input_xlsx>`, `--out <summary_xlsx>` (default `summary_urlfilters.xlsx`)

**Outputs:**
- Excel: One sheet "Summary" with category summary

**External Dependencies:**
- pandas, openpyxl (via pandas ExcelFile/ExcelWriter)

**State/Persistence:**
- None

**Side-Effect Risk:**
- Read-only

**Web-Port Assessment:** **Easy** – Pure Excel transformation. Could be step 2 after `xml_url_filter_to_excel.py`:
1. Parse PAN XML → 3 workbooks
2. Optionally produce summary view

---

#### 27. **xml_diff_app_group_output_files.py**

**What it does:**
Finds two `*_application-group.xlsx` files in the current directory (sorted), reads them as row tuples, computes added (set_new - set_old) and removed (set_old - set_new) rows, and writes an Excel file with a "diff" sheet containing all rows plus a "change" column (values: "added" or "removed").

**Inputs:**
- Files: Two `*_application-group.xlsx` in working directory (found by glob)
- CLI args: `--output <output_xlsx>` (default `application-group-diff.xlsx`)

**Outputs:**
- Excel: Sheet "diff" with all unique rows + "change" column

**External Dependencies:**
- openpyxl, glob, os

**State/Persistence:**
- None

**Side-Effect Risk:**
- Read-only

**Web-Port Assessment:** **Easy** – Pure file comparison. However, assumes exactly 2 files in directory, which is awkward for web UI. Better to accept two file uploads explicitly.

---

### Category 7: Utility & Reference

#### 28. **fmg_build_global_order.py**

**What it does:**
Attempts to build a global policy order for FortiManager from per-firewall Excel sheets. Reads 9 Excel files (one per PAN firewall) with rule names in column C. For each sheet (firewall), builds an order graph where rule A → rule B if B appears after A on that firewall. Uses Kahn's topological sort to merge all orders. Outputs CSV with proposed global order.

**Status:** **Deprecated** – Script notes say "doesn't work as intended" and "rebuild, or do this part by hand."

**Inputs:**
- Interactive prompts: FMG IP, username, password, ADOM, package name, Excel workbook path
- Excel file: Multiple sheets, each with rule names in column C

**Outputs:**
- CSV: `proposed_policy_order.csv` with [order, policy_name, policyid, fmg_truncated_name, devices]

**External Dependencies:**
- pandas, requests, urllib3, csv, collections, deque

**Side-Effect Risk:**
- Reads from FMG API (no mutations)

**Web-Port Assessment:** **Skip** – Author notes it doesn't work. If porting is needed, requires significant refactoring.

---

#### 29. **ftnt_get_fmg_policies.py**

**What it does:**
Reads a CSV with a `policyname` column. Logs into FMG via JSON-RPC, queries for each policy name from the CSV, and exports matching policies (one per line) into a JSON file.

**Inputs:**
- CSV: Column `policyname` or `name`
- Interactive: FMG IP, username, password, ADOM, package name

**Outputs:**
- JSON: Array of policy objects

**External Dependencies:**
- requests, urllib3, csv, json, argparse, getpass, pathlib

**State/Persistence:**
- Reads from FMG API

**Side-Effect Risk:**
- Read-only on FMG

**Web-Port Assessment:** **Easy** – Pure data extraction. Could be:
1. Upload CSV of policy names
2. Download JSON of full policy definitions

---

#### 30. **fortiguard_rating/get_web_rating.py**

**What it does:**
Reads a CSV with [url, url-filter] columns. For each URL, sanitizes it (strip `*.` leading chars), queries FortiGuard premium API (`https://premiumapi.fortinet.com/v1/rate`) with Bearer token, and collects [URL (queried), Category, Category ID, URL Filter] into output Excel.

**Status:** **Stub** – Requires API token (currently shows placeholder `$token`). Would need real API key to use.

**Inputs:**
- CSV: [url, url-filter]
- Env/CLI: API token (hardcoded placeholder in script)
- Input filename: Hardcoded `round2_urls.csv`, output hardcoded `round2_fortiguard_ratings.xlsx`

**Outputs:**
- Excel: [URL (queried), Category, Category ID, URL Filter]

**External Dependencies:**
- requests, pandas

**Side-Effect Risk:**
- Network call to FortiGuard API (rate-limited with 1-second sleep per URL)
- Requires valid API token (security consideration)

**Web-Port Assessment:** **Medium** – Requires:
1. Valid FortiGuard API token (secure storage)
2. Rate limiting (1 req/sec per code)
3. Async job for bulk processing
4. Clear cost implications if API usage is metered

---

#### 31. **ftnt_apps_to_excel/json_to_excel.py**

**What it does:**
Converts FortiManager application and category JSON exports to Excel. Reads two JSON files (apps.json and categories.json), maps app "cat-id" integers to category names, and writes all app attributes to Excel with human-readable category names instead of IDs.

**Inputs:**
- JSON files: `--apps <apps.json>`, `--cats <categories.json>`
- CLI args: `-o <output.xlsx>` (default `applications.xlsx`)
- Expected JSON structure: `data.result[0].data` = array of objects

**Outputs:**
- Excel: One sheet "applications" with all app attributes + resolved category names

**External Dependencies:**
- json, openpyxl, argparse, pathlib

**State/Persistence:**
- None

**Side-Effect Risk:**
- Read-only

**Web-Port Assessment:** **Easy** – Pure data transformation. UI:
- Upload two JSON files
- Download Excel

---

### Category 8: Deprecated/Incomplete

#### 32–34. **Comparator Scripts (fmg_object_compare/)**

**fmg_object_compare/compare.py** and **fmg_object_compare/compare2.py**

**What they do:**
Both scripts compare FortiGate config objects (address, addrgrp, service, service group) against FortiManager objects. They:
1. Parse a local FortiGate config file to extract object names
2. Log into FMG and fetch equivalent objects
3. Compare and report duplicate names / conflicts

**Key differences:**
- `compare.py` – Older version, simpler structure
- `compare2.py` – Newer version with more detailed parsing and conflict detection (compares type + value)

**Inputs:**
- File: FortiGate config
- Env/CLI: FMG credentials, ADOM
- Optional: List of addresses to check (hardcoded or from file)

**Outputs:**
- Text report: Duplicate/conflict summary

**External Dependencies:**
- requests, urllib3, json, os, sys

**State/Persistence:**
- Reads FMG API (no mutations)
- Hard-coded FMG IP, credentials in code (security concern)

**Web-Port Assessment:** **Skip** – Both have hard-coded credentials and are meant as one-off scripts. If porting object comparison, better to build a dedicated comparison module with proper UI.

---

## Web-Port Priority List

### Tier 1: Highest Value × Lowest Implementation Cost (Port First)

1. **xml_ssldecryption_to_csv.py**
   - **Why:** Stable, file-only, part of core migration workflow
   - **Effort:** 1–2 days
   - **Sketch:** Upload PAN XML → Download SSL Decryption CSV
   - **Inputs:** File upload (XML)
   - **Outputs:** Downloadable CSV
   - **Pre-req:** None

2. **xml_to_csv_custom_url_categories.py**
   - **Why:** Core PAN parsing, widely used
   - **Effort:** 1–2 days
   - **Sketch:** Upload PAN XML → Download URL Categories CSV
   - **Inputs:** File upload (XML)
   - **Outputs:** Downloadable CSV
   - **Pre-req:** None

3. **fuzzy_match/fuzzy_match.py**
   - **Why:** Useful for comparing app/object lists, general utility
   - **Effort:** 2–3 days
   - **Sketch:** Upload two CSVs → Download match results CSV
   - **Inputs:** Two file uploads, optional threshold slider
   - **Outputs:** Downloadable CSV
   - **Pre-req:** None

4. **ftnt_trim_overlength_names.py**
   - **Why:** Part of config cleanup pipeline
   - **Effort:** 2–3 days
   - **Sketch:** Upload config → Download trimmed config + name map CSV
   - **Inputs:** File upload (FGT config)
   - **Outputs:** Two downloadable files
   - **Pre-req:** None

5. **post-fcon-normalizer.py**
   - **Why:** Lightweight config cleanup
   - **Effort:** 1–2 days
   - **Sketch:** Upload config → Download normalized config
   - **Inputs:** File upload
   - **Outputs:** Downloadable config
   - **Pre-req:** None

### Tier 2: Medium Value, Moderate Effort (Port Second)

6. **xml_parse_profile_groups.py** / **xml_parse_app_groups.py** / **xml_url_filter_to_excel.py**
   - **Why:** Batch these into "PAN XML Extraction Suite"
   - **Effort:** 3–4 days (batch all three)
   - **Sketch:** Single upload → multiple downloads (CSV + Excel)
   - **Inputs:** Single PAN XML file
   - **Outputs:** 3+ files (CSVs + Excel workbooks)
   - **Pre-req:** None

7. **xml_to_csv_rule_reporter.py**
   - **Why:** Important for rule analysis
   - **Effort:** 2–3 days
   - **Sketch:** Upload PAN XML → Download rule report CSV
   - **Pre-req:** None

8. **db_search/db_search.py** + **db_search_local_cat.py**
   - **Why:** Requires pre-seeded DB, but valuable reference tool
   - **Effort:** 2–3 days
   - **Sketch:** Paste/upload search terms → Download matches CSV
   - **Inputs:** CSV of search terms (or paste-in textarea)
   - **Outputs:** Downloadable CSV
   - **Pre-req:** FMG DB (from fmg_fetch_objects.py run)
   - **Notes:** Add admin interface to manage DB (upload new DB, delete old)

9. **parse_fmg_adom_export.py**
   - **Why:** Quick utility, rarely used
   - **Effort:** 1 day
   - **Sketch:** Upload ADOM export → Download cleaned export
   - **Pre-req:** None

### Tier 3: High Value But Require Live API Access (Port Third)

10. **fmg_fetch_objects.py** (Async Job)
    - **Why:** Core dependency for FMG-based tools
    - **Effort:** 4–5 days (including async job infrastructure)
    - **Sketch:** Trigger button → Shows progress → Stores result in DB → Download/view results
    - **Inputs:** FMG credentials (from app's existing auth layer) + ADOM selection
    - **Outputs:** SQLite DB (stored on server, accessible to other tools)
    - **Pre-req:** App's FMG auth system
    - **Notes:** Ensure credentials are encrypted in transit; consider rate limiting to prevent duplicate runs

11. **fmg_url_crosscheck.py** (Async Job)
    - **Why:** Valuable for custom URL validation
    - **Effort:** 4–5 days
    - **Sketch:** Upload CSV → Trigger check → Async job → Download report
    - **Pre-req:** FMG auth + pre-populated FMG DB (or fetch fresh)

12. **db_search.py** (Post fmg_fetch_objects)
    - **Re-prioritize after:** fmg_fetch_objects is ported
    - **Effort:** 2–3 days
    - **Sketch:** Paste search terms → Download matches CSV

### Tier 4: Advanced, Special Handling Required (Port Last or Skip)

13. **app_match_tool_gpu/app_match.py**
    - **Why:** Powerful but complex (GPU, LLM, heavy dependencies)
    - **Effort:** 7–10 days
    - **Sketch:** Upload two CSVs → Select matching method (string / embedding / FAISS / LLM) → Async job → Download parquet + optional graph
    - **Inputs:** Two CSVs, optional OpenAI API key, optional GPU toggle
    - **Outputs:** Parquet (+ optional GraphML)
    - **Pre-req:** GPU support (optional), sentence-transformers model cache, OpenAI API key (optional)
    - **Notes:** Add progress bar; auto-fallback to CPU if GPU unavailable; caching built-in

14. **app_match_tool_gpu/export_results.py**
    - **Depends on:** app_match.py
    - **Effort:** 1–2 days
    - **Sketch:** Auto-run after app_match.py; download CSV view

15. **fortiguard_rating/get_web_rating.py**
    - **Why:** Requires external API key (security + cost)
    - **Effort:** 3–4 days
    - **Sketch:** Upload CSV → Async job → Download Excel (with rate limiting)
    - **Pre-req:** FortiGuard API token (user-provided or org-provided)

### Tier 5: Dangerous/Not Recommended for Web UI

16. **fgt_delete_duplicate_inet_from_config.py**
    - **Risk:** Destructive config edit (removes policies)
    - **Recommendation:** Port as **dry-run tool only**
      - Upload config → Compare against FGT → Show preview of what would be removed
      - NO automatic apply; user downloads cleaned config for manual review/import
    - **Effort:** 4–5 days
    - **Sketch:** Upload config → Connect to FGT → Show diff preview → Download cleaned config (no apply)
    - **Pre-req:** FGT token (secure storage)

17. **fgt_delete_non_inet_policies.py**
    - **Risk:** Very high; live policy deletions
    - **Recommendation:** **Do NOT port to web UI without significant controls:**
      - Dry-run preview only
      - Require approval from multiple users (RBAC)
      - Backup FGT before deletion
      - Staged deletion (one-at-a-time confirmation)
    - **Effort:** 6–8 days (if porting with safety controls)
    - **Sketch:** Three-step wizard: (1) preview, (2) backup, (3) staged delete with confirmation per policy

18. **fmg_set_scope_from_csv.py**
    - **Risk:** Medium; mutates FMG policy scopes
    - **Recommendation:** Port with **dry-run preview + staged updates**
      - Upload CSV → Fetch FMG policies → Show proposed updates → Preview mode → Apply updates step-by-step
    - **Effort:** 5–6 days
    - **Sketch:** Two-mode wizard: (1) preview all changes, (2) apply with per-policy confirmation

### Tier 6: Skip (Deprecated/Incomplete)

- **fmg_build_global_order.py** – Author says "doesn't work"; skip unless rebuild is justified
- **ftnt_match_app_ids.py** – Incomplete stub; skip
- **fmg_object_compare/compare.py** + **compare2.py** – Hard-coded credentials; skip in favor of dedicated comparison module
- **shared_rules.py** – Low-priority utility; port only if time permits
- **pan_analyze_ssl_decrypt_diffs.py** – Niche utility; port only if needed

---

## Suggested Integration Shapes

### PAN XML Extraction Suite (Port as Cohesive Feature)

Bundle these into a single "PAN XML Parser" tool:

```
┌─────────────────────────────────────────────┐
│ 🔷 PAN XML Extraction Suite                 │
├─────────────────────────────────────────────┤
│ Upload Palo Alto .merged-running-config.xml │
│ [Choose upload button]                       │
│                                             │
│ ☑ Extract SSL Decryption Rules              │
│ ☑ Extract Custom URL Categories             │
│ ☑ Extract Profile Groups                    │
│ ☑ Extract Application Groups                │
│ ☑ Extract Security Rules                    │
│ ☑ Extract URL Filtering Profiles            │
│ ☑ Convert Wildcard Objects                  │
│                                             │
│ [Parse] → Download Multiple Files           │
│           ├─ ssl_decrypt_rules.csv          │
│           ├─ url_categories.csv             │
│           ├─ profile_groups.csv             │
│           ├─ app_groups.xlsx                │
│           ├─ security_rules.csv             │
│           ├─ url_filters_profiles.xlsx      │
│           └─ wildcard_addresses.conf        │
└─────────────────────────────────────────────┘
```

### Config Cleanup Pipeline (Sequential Steps)

```
┌─────────────────────────────────────────────────────────┐
│ 🔧 FortiGate Config Cleanup Pipeline                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Step 1: Trim Long Names                                │
│ ────────────────────────────────────────────────────   │
│ Upload FortiGate config (from FortiConverter)           │
│ [Choose upload button]                                  │
│ [Trim Names]                                            │
│   → Download cleaned_config.conf                        │
│   → Download name_map.csv                               │
│                                                         │
│ Step 2: Normalize Comments                              │
│ ────────────────────────────────────────────────────   │
│ Upload trimmed config (or paste-in textarea)            │
│ [Normalize Comments]                                    │
│   → Download normalized_config.conf                     │
│                                                         │
│ Step 3: Remove Duplicate Policies (Dry-Run)             │
│ ────────────────────────────────────────────────────   │
│ Upload normalized config                                │
│ FortiGate IP: [input] Token: [password field]           │
│ [Check Against FGT]                                     │
│   → Show preview of policies that would be removed      │
│   → Download cleaned_config.conf (no live deletion)     │
│                                                         │
│ Step 4: Download Final Config                           │
│ ────────────────────────────────────────────────────   │
│ [Download] → ready for manual FGT import                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### FortiManager Data Management (Background Jobs)

```
┌─────────────────────────────────────────────────────────┐
│ 📊 FortiManager Object Store                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Current Database Status:                                │
│   ✓ Last updated: 2025-04-09 15:30 UTC                 │
│   Objects: 4,521                                        │
│   URL Filters: 1,203                                    │
│   SSL Exempt: 87                                        │
│                                                         │
│ [Refresh Database] → Polls FMG for latest objects       │
│ [Download Database] → Export as SQLite file             │
│                                                         │
│ Actions:                                                │
│ ──────────────────────────────────────────────────────  │
│ • Search Objects → [Use FMG Search tool below]          │
│ • Cross-Check URLs → [Use FMG URL Crosscheck tool]      │
│ • Analyze Objects → [Use Comparison tool]               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Object Search & Lookup

```
┌─────────────────────────────────────────────────────────┐
│ 🔍 FMG Object Search                                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Search Terms (CSV or paste):                            │
│ [Textarea or file upload]                               │
│                                                         │
│ Search Type: ◉ General ○ URL-specific                   │
│                                                         │
│ [Search] → Returns CSV:                                 │
│   term, table, column, rowid, match_value               │
│   10.0.1.0, address_ipmask, subnet, 42, 10.0.1.0/24    │
│   ...                                                   │
│                                                         │
│ [Download Results CSV]                                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Application Matching

```
┌─────────────────────────────────────────────────────────┐
│ 🎯 Application Signature Matcher                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Fortinet Apps CSV: [Choose upload]                      │
│ Palo Alto Apps CSV: [Choose upload]                     │
│                                                         │
│ Matching Options:                                       │
│   Method: ◉ Fast (String+Embedding)                     │
│           ○ Thorough (w/ GPU Faiss)                     │
│           ○ LLM-Assisted (requires OpenAI key)          │
│                                                         │
│   High Score Threshold: [slider: 0.75]                  │
│   Gray Zone Threshold: [slider: 0.50]                   │
│   Embedding Similarity: [slider: 0.80]                  │
│                                                         │
│ OpenAI API Key (optional): [password field]             │
│   ✓ Enables LLM mode (costs ~$0.10 per 100 apps)       │
│                                                         │
│ GPU Mode: ☑ Auto-detect   ☐ Force CPU                   │
│                                                         │
│ [Start Matching] → Job queued; you'll get:              │
│   ✓ matches.parquet (raw match data)                    │
│   ✓ matches.csv (human-readable summary)                │
│   ✓ network_graph.graphml (optional network viz)        │
│                                                         │
│ Progress: [████████░░] 85% – 2 min remaining            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Resolved Architectural Decisions (2026-04-09)

The open questions below were reviewed with the user. Decisions:

1. **Credentials** — Reuse the app's existing FMG session layer. Conversion tools never persist tokens of their own; they borrow the caller's authenticated FMG session.
2. **Per-user state** — `fmg_fetch_objects` and any sibling sqlite caches are scoped per-user. Suggested layout: `backend/user_data/<user_id>/fmg_objects.db`, gitignored alongside the existing sensitive files.
3. **Mutation tools (`fgt_delete_*`, `fmg_set_scope_from_csv`)** — Deferred until RBAC lands. RBAC scope (initial): `admin` / `operator` / `viewer` roles wired into `user_store.json`, enforced by FastAPI route guards and a frontend `useUser()` hook gating dangerous UI. Until RBAC ships, these scripts stay CLI-only.
4. **Job queue → ARQ + Redis.** Chosen over Celery because:
   - Our FMG client is already async (`httpx.AsyncClient`); Celery's sync workers would force `asyncio.run()` per task and break connection reuse.
   - Single new infra dep (Redis) — same as Celery's minimum.
   - I/O-bound workloads (FMG fetchers, FortiGuard polling) scale fine on a single ARQ asyncio worker.
   - GPU app-matcher can run on a dedicated worker pool when we get there.
   - We have no use case for Celery's heavyweight features (canvas, beat, chords) in the audited script set.
   - Plumb ARQ from Phase 1 even though tier-1 parsers don't need it, so Phase 4 (FMG fetchers) doesn't require a refactor.
5. **Cost gating for LLM / FortiGuard** — Required for any tool that hits paid APIs. Gate behind explicit user confirmation + per-job budget cap.

The "Questions for the User" list below is preserved for historical context; items 1, 2, 3, 4, 6 are resolved above. Items 5, 7, 8 remain open.

### Questions for the User

1. **Authentication & Credential Management:**
   - How should FMG/FGT credentials be stored in a web context?
     - Option A: User provides on each request (stateless, least secure)
     - Option B: Secure session/token store (best for web, requires encryption)
     - Option C: Integration with existing app's FMG auth layer (reuse existing session)?
   - Should we support multiple concurrent FMG/FGT connections, or single shared instance?

2. **Database Persistence:**
   - Should the SQLite DB from `fmg_fetch_objects.py` be:
     - Stored per-user (isolated, slower)?
     - Shared (fast, less isolated)?
     - Versioned with timestamps?
   - How often should the DB be refreshed? (daily cron? manual trigger?)

3. **API Mutation Workflows (Deletion/Updates):**
   - For `fgt_delete_non_inet_policies.py` and `fmg_set_scope_from_csv.py`: are these critical enough to port with full safety controls, or should they remain CLI-only?
   - If porting, what approval workflow is needed? (single user, multi-user sign-off, scheduled maintenance windows?)

4. **Job Queue & Async Operations:**
   - Should we use existing job queue (Celery, RQ, etc.) or implement custom?
   - How long should jobs be retained in history (for re-download)?

5. **File Size & Performance:**
   - Largest expected PAN XML? (impacts parsing time, memory)
   - Largest expected FMG object count? (impacts DB size, query time)
   - Expected concurrent users running matching jobs? (impacts GPU/CPU scheduling)

6. **Cost & External Services:**
   - Is using OpenAI API for LLM matching acceptable? (adds cost, ~$0.01 per pair in gpt-4o-mini)
   - Are FortiGuard API queries expected? (needs cost/rate-limit policy)

7. **Deprecated Scripts:**
   - Should `fmg_build_global_order.py` be fixed (high effort) or dropped?
   - Are there other scripts in the user's workflow not listed that should be included?

8. **Pre-migration vs. Post-migration Tools:**
   - Are these tools meant for **pre-migration analysis** (comparing PAN ↔ Fortinet structures) or **post-migration validation** (comparing migrated policies against source)?
   - Does the web app need to support both?

---

## Summary: Quick Reference

### Script Count by Category

| Category | Count | Recommended Port Status |
|----------|-------|------------------------|
| PAN XML Parsers | 8 | ✅ Port all (Tier 1) |
| FMG Fetchers | 3 | ✅ Port async (Tier 3) |
| FGT Mutators | 2 | ⚠️ Dry-run only (Tier 5) |
| Config Transformers | 5 | ✅ Port all (Tier 1–2) |
| Comparators | 2 | ⚠️ Rebuild; skip stubs (Tier 6) |
| DB Search | 2 | ✅ Port (Tier 2–3) |
| Fuzzy Match | 1 | ✅ Port (Tier 1) |
| Advanced Matching (GPU/LLM) | 2 | ✅ Port async (Tier 4) |
| Utilities | 7 | ⚠️ Mix; prioritize core |
| Deprecated | 4 | ❌ Skip |
| **TOTAL** | **34** | |

### Porting Effort Estimate

| Tier | Effort | Scripts | Timeline |
|------|--------|---------|----------|
| **1–2 (Easy)** | 1–3 days each | 12 scripts | 3–4 weeks |
| **3 (Medium, API)** | 4–5 days each | 3 scripts | 2–3 weeks |
| **4 (Advanced)** | 7–10 days each | 2 scripts | 2–3 weeks |
| **5 (Dangerous)** | 4–8 days each | 3 scripts | 2–3 weeks |
| **6 (Skip)** | 0 | 4 scripts | 0 |
| **TOTAL** | | 24 scripts | **3–4 months** (parallel) |

### Recommended Phased Rollout

**Phase 1 (Weeks 1–2): PAN XML Parser Suite**
- Port all 8 XML parsers + pan_analyze_ssl_decrypt_diffs
- Bundle as cohesive "PAN XML Extraction Tool"
- No external deps or APIs required

**Phase 2 (Weeks 3–4): Config Cleanup Pipeline**
- Port ftnt_trim_overlength_names + post-fcon-normalizer + parse_fmg_adom_export
- Chain as sequential step-by-step UI
- No external deps required

**Phase 3 (Weeks 5–6): Database & Search Tools**
- Port db_search + db_search_local_cat + fuzzy_match
- Requires pre-seeded SQLite DB (manage separately)

**Phase 4 (Weeks 7–10): FortiManager Integration**
- Port fmg_fetch_objects + fmg_fetch_url_filters + fmg_export_ssl_exempt (async jobs)
- Port fmg_url_crosscheck (async job with FMG auth reuse)
- Requires secure credential storage + FMG API access

**Phase 5 (Weeks 11–14): Advanced Matching**
- Port app_match.py + export_results.py (async GPU/LLM job)
- Port fortiguard_rating.py (requires API key + rate limiting)

**Phase 6 (Weeks 15+): Dangerous Operations (Optional)**
- Port fgt_delete_duplicate_inet_from_config (dry-run only)
- Port fgt_delete_non_inet_policies (staged deletion with RBAC)
- Port fmg_set_scope_from_csv (staged updates with preview)

---

**End of Audit**

Generated: 2025-04-09  
Auditor: Claude Code Research Agent  
Status: Complete – Ready for Architecture & Implementation Planning
