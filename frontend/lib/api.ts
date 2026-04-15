const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("fmg_token");
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = { ...authHeaders(), ...init?.headers };
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    // Token expired — clear and redirect
    localStorage.removeItem("fmg_token");
    localStorage.removeItem("fmg_user");
    window.location.href = "/login";
    throw new Error("Session expired");
  }
  return res;
}

export async function login(
  username: string,
  password: string
): Promise<{ token: string; username: string; needsSetup: boolean }> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Authentication failed");
  }
  const data = await res.json();
  localStorage.setItem("fmg_token", data.token);
  localStorage.setItem("fmg_user", data.username);
  return data;
}

export async function register(
  username: string,
  password: string
): Promise<{ token: string; username: string; needsSetup: boolean }> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Registration failed");
  }
  const data = await res.json();
  localStorage.setItem("fmg_token", data.token);
  localStorage.setItem("fmg_user", data.username);
  return data;
}

export async function logout(): Promise<void> {
  try {
    await authFetch(`${API_BASE}/api/auth/logout`, { method: "POST" });
  } catch {
    // ignore
  }
  localStorage.removeItem("fmg_token");
  localStorage.removeItem("fmg_user");
}

export async function verifySession(): Promise<{
  valid: boolean;
  username?: string;
  activeInstance?: FmgInstance | null;
  instances?: FmgInstance[];
  needsSetup?: boolean;
}> {
  const token = getToken();
  if (!token) return { valid: false };
  try {
    const res = await fetch(`${API_BASE}/api/auth/verify`, {
      headers: authHeaders(),
    });
    if (!res.ok) return { valid: false };
    const data = await res.json();
    return {
      valid: true,
      username: data.username,
      activeInstance: data.activeInstance,
      instances: data.instances,
      needsSetup: data.needsSetup,
    };
  } catch {
    return { valid: false };
  }
}

export async function checkSetupRequired(): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/auth/setup-required`);
  if (!res.ok) return true;
  const data = await res.json();
  return data.setupRequired;
}

export async function connectFmg(instanceId: string): Promise<FmgInstance> {
  const res = await authFetch(`${API_BASE}/api/auth/connect-fmg`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instance_id: instanceId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Failed to connect to FMG");
  }
  const data = await res.json();
  return data.activeInstance;
}

// ---------------------------------------------------------------------------
// FMG instance management
// ---------------------------------------------------------------------------

export interface FmgInstance {
  id: string;
  name: string;
  host: string;
  username: string;
  adom: string;
  verify_ssl: boolean;
}

export async function fetchFmgInstances(): Promise<FmgInstance[]> {
  const res = await authFetch(`${API_BASE}/api/settings/fmg-instances`);
  if (!res.ok) throw new Error("Failed to fetch FMG instances");
  return res.json();
}

export async function addFmgInstance(instance: {
  name: string;
  host: string;
  fmg_username: string;
  fmg_password: string;
  adom?: string;
  verify_ssl?: boolean;
}): Promise<{ id: string; name: string }> {
  const res = await authFetch(`${API_BASE}/api/settings/fmg-instances`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(instance),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Failed to add instance");
  }
  return res.json();
}

export async function updateFmgInstance(
  instanceId: string,
  updates: Record<string, unknown>
): Promise<void> {
  const res = await authFetch(
    `${API_BASE}/api/settings/fmg-instances/${instanceId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }
  );
  if (!res.ok) throw new Error("Failed to update instance");
}

export async function deleteFmgInstance(instanceId: string): Promise<void> {
  const res = await authFetch(
    `${API_BASE}/api/settings/fmg-instances/${instanceId}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error("Failed to delete instance");
}

// ---------------------------------------------------------------------------
// Profile types & data
// ---------------------------------------------------------------------------

export interface ProfileType {
  id: string;
  label: string;
}

export interface ComparisonField {
  field_path: string;
  label: string;
  values: Record<string, unknown>;
  in_sync: boolean;
  /** Per-profile drift map. Empty when no baseline was set. */
  differs_from_baseline?: Record<string, boolean>;
}

export interface ComparisonResponse {
  profile_type: string;
  profile_names: string[];
  fields: ComparisonField[];
  collection_keys: string[];
  raw_profiles: Record<string, Record<string, unknown>>;
  /** Echo of the baseline profile name when one was set. */
  baseline?: string | null;
}

export interface PinnedFieldsResponse {
  profile_type: string;
  pinned_fields: string[];
}

export interface ReferenceListResponse {
  reference_type: string;
  count: number;
  items: Record<string, unknown>[];
}

export async function fetchProfileTypes(): Promise<ProfileType[]> {
  const res = await authFetch(`${API_BASE}/api/profiles/types`);
  if (!res.ok) throw new Error("Failed to fetch profile types");
  return res.json();
}

export async function fetchProfiles(type: string): Promise<string[]> {
  const res = await authFetch(`${API_BASE}/api/profiles/${type}`);
  if (!res.ok) throw new Error("Failed to fetch profiles");
  const data = await res.json();
  return data.profiles;
}

export async function compareProfiles(
  type: string,
  names: string[],
  baseline: string | null = null,
): Promise<ComparisonResponse> {
  const parts = names.map((n) => `name=${encodeURIComponent(n)}`);
  if (baseline) parts.push(`baseline=${encodeURIComponent(baseline)}`);
  const params = parts.join("&");
  const res = await authFetch(`${API_BASE}/api/profiles/${type}/compare?${params}`);
  if (!res.ok) throw new Error("Failed to compare profiles");
  return res.json();
}

export async function fetchPins(type: string): Promise<string[]> {
  const res = await authFetch(`${API_BASE}/api/profiles/${type}/pins`);
  if (!res.ok) throw new Error("Failed to fetch pins");
  const data: PinnedFieldsResponse = await res.json();
  return data.pinned_fields;
}

export async function togglePin(
  type: string,
  fieldPath: string,
  pinned: boolean
): Promise<string[]> {
  const res = await authFetch(`${API_BASE}/api/profiles/${type}/pins`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_type: type, field_path: fieldPath, pinned }),
  });
  if (!res.ok) throw new Error("Failed to toggle pin");
  const data: PinnedFieldsResponse = await res.json();
  return data.pinned_fields;
}

// ---------------------------------------------------------------------------
// Schema discovery (FMG syntax queries, cached server-side)
// ---------------------------------------------------------------------------

export interface SchemaField {
  name: string;
  label: string;
  help: string;
  type: string;
}

export interface SchemaResponse {
  fields: SchemaField[];
  subobjects: Record<string, SchemaField[]>;
  profile_type?: string;
}

export async function fetchProfileSchema(type: string): Promise<SchemaResponse> {
  const res = await authFetch(`${API_BASE}/api/schemas/profile/${type}`);
  if (!res.ok) throw new Error(`Failed to fetch schema for ${type}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export interface ReferenceListResponse {
  reference_type: string;
  count: number;
  items: Record<string, unknown>[];
}

export async function fetchApplicationSignatures(): Promise<ReferenceListResponse> {
  const res = await authFetch(`${API_BASE}/api/reference/application-signatures`);
  if (!res.ok) throw new Error("Failed to fetch application signatures");
  return res.json();
}

export async function fetchIpsSignatures(): Promise<ReferenceListResponse> {
  const res = await authFetch(`${API_BASE}/api/reference/ips-signatures`);
  if (!res.ok) throw new Error("Failed to fetch IPS signatures");
  return res.json();
}

export async function fetchDlpSensors(): Promise<ReferenceListResponse> {
  const res = await authFetch(`${API_BASE}/api/reference/dlp-sensors`);
  if (!res.ok) throw new Error("Failed to fetch DLP sensors");
  return res.json();
}

export async function fetchDlpDictionaries(): Promise<ReferenceListResponse> {
  const res = await authFetch(`${API_BASE}/api/reference/dlp-dictionaries`);
  if (!res.ok) throw new Error("Failed to fetch DLP dictionaries");
  return res.json();
}

export async function fetchDlpDataTypes(): Promise<ReferenceListResponse> {
  const res = await authFetch(`${API_BASE}/api/reference/dlp-data-types`);
  if (!res.ok) throw new Error("Failed to fetch DLP data types");
  return res.json();
}

// ---------------------------------------------------------------------------
// FortiGuard encyclopedia — hover tooltip lookups
//
// These call the undocumented FMG GUI CGI API (productapi) on the backend.
// The two response shapes share a common core (Name/Risk/Summary/etc) plus
// source-specific extensions (IPS: CVE/VulnType/DetectionAvailability; App:
// Category/Vendor/AppPort/References). We model them as a discriminated
// union keyed on `Type`.
// ---------------------------------------------------------------------------

export interface EncyclopediaBase {
  ID: number;
  Name: string;
  Risk: string;
  RiskID: number;
  Summary: string;
  Symptoms: string;
  Analysis: string;
  Action: string;
  DefaultAction: string;
  BehaviorList: string[];
  os_list: string[];
  app_list: string[];
  Released: string;
  Created: string;
  Updated: string;
}

export interface IpsEncyclopedia extends EncyclopediaBase {
  Type: "ips";
  CVE: string;
  cve_id: string;
  max_epss: string;
  kev: unknown[];
  isActive?: boolean;
  GroupID?: number;
  VulnType: string;
  SecurityRefs: unknown[];
  OutbreakAlert: unknown[];
  ThreatSignal: unknown[] | null;
  DetectionAvailability: {
    product: string;
    sigdb: string;
    status: boolean;
  }[];
  Telemetry?: boolean;
}

export interface ApplicationEncyclopedia extends EncyclopediaBase {
  Type: "app";
  Category: string;
  CVE: string | null;
  Popularity: number;
  AppPort: string;
  References: string[];
  DeepAppCtrl: boolean;
  Vendor: string;
  Deprecated: boolean;
  Language: string;
  Technology: string[];
  RequireApp?: { vuln_id: number; vuln_name: string }[];
  ApplicationCategory?: number;
  OutbreakAlert?: unknown[];
  ThreatSignal?: unknown[] | null;
}

export type EncyclopediaResponse = IpsEncyclopedia | ApplicationEncyclopedia;

export async function fetchIpsEncyclopedia(
  signatureId: number,
): Promise<IpsEncyclopedia> {
  const res = await authFetch(
    `${API_BASE}/api/reference/ips-signatures/${signatureId}/encyclopedia`,
  );
  if (!res.ok) throw new Error("Failed to fetch IPS encyclopedia");
  return res.json();
}

export async function fetchApplicationEncyclopedia(
  signatureId: number,
): Promise<ApplicationEncyclopedia> {
  const res = await authFetch(
    `${API_BASE}/api/reference/application-signatures/${signatureId}/encyclopedia`,
  );
  if (!res.ok) throw new Error("Failed to fetch application encyclopedia");
  return res.json();
}

// ---------------------------------------------------------------------------
// Internet Service Database (ISDB) — proxied through FMG to a managed FortiGate
//
// FortiManager itself doesn't host these APIs; we pipe every call through
// /sys/proxy/json to a user-selected FortiGate. The first feature to ship on
// this surface is the FQDN catalog (FortiGuard's map of well-known SaaS
// FQDN groups). IP lookup lands in a follow-up task.
// ---------------------------------------------------------------------------

export interface IsdbDevice {
  name: string;
  hostname: string | null;
  platform: string | null;
  os_version: string;
  ip: string | null;
  ha_mode: string | null;
  conn_status: string | null;
}

export interface IsdbFqdnGroup {
  name: string;
  fqdns: string[];
}

export interface IsdbFqdnCatalog {
  device: string;
  vdom: string;
  cached: boolean;
  group_count: number;
  fqdn_count: number;
  groups: IsdbFqdnGroup[];
  fetched_at: number;
}

export async function fetchIsdbDevices(): Promise<IsdbDevice[]> {
  const res = await authFetch(`${API_BASE}/api/tools/isdb/devices`);
  if (!res.ok) throw new Error("Failed to fetch managed FortiGates");
  const data = await res.json();
  return data.devices ?? [];
}

export async function fetchIsdbFqdnCatalog(
  device: string,
  vdom: string = "root",
  refresh: boolean = false,
): Promise<IsdbFqdnCatalog> {
  const qs = new URLSearchParams({ device, vdom });
  if (refresh) qs.set("refresh", "true");
  const res = await authFetch(
    `${API_BASE}/api/tools/isdb/fqdn?${qs.toString()}`,
  );
  if (!res.ok) {
    // Surface the backend error message so the UI can show "device
    // offline" / "proxy timeout" instead of a generic failure.
    let detail = "FQDN catalog lookup failed";
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    throw new Error(detail);
  }
  return res.json();
}

/* ----- IP lookup shapes ----- */

export interface IsdbReverseDns {
  ok: boolean;
  resolved?: boolean;
  domain?: string | null;
  error?: string;
}

export interface GeoipLocation {
  city?: { geoname_id?: number; names?: Record<string, string> };
  continent?: { code?: string; names?: Record<string, string> };
  country?: { iso_code?: string; names?: Record<string, string> };
  location?: {
    latitude?: number;
    longitude?: number;
    time_zone?: string;
    accuracy_radius?: number;
  };
  postal?: { code?: string };
  subdivisions?: { iso_code?: string; names?: Record<string, string> }[];
}

export interface IsdbGeoip {
  ok: boolean;
  location?: GeoipLocation;
  fallback?: boolean;
  error?: string;
}

export interface IsdbServiceMatch {
  id: number;
  name?: string;
  num_matched_services?: number;
  owner?: { id?: number; name?: string };
  reputation?: number;
  popularity?: number;
  botnet_id?: number;
  domain_id?: number;
  country_id?: number;
  region_id?: number;
  city_id?: number;
  blocklist?: { vendor_id: number; reason_id: number }[];
}

export interface IsdbMatchesSection {
  ok: boolean;
  services: IsdbServiceMatch[];
  error?: string;
  match_error?: string;
  reputation_error?: string;
}

export interface IsdbLookupResponse {
  device: string;
  vdom: string;
  input: string;
  ip: string;
  is_ipv6: boolean;
  resolved_from_fqdn: string | null;
  reverse_dns: IsdbReverseDns;
  geoip: IsdbGeoip;
  matches: IsdbMatchesSection;
  cached: boolean;
  fetched_at: number;
}

export async function fetchIsdbIpLookup(
  device: string,
  target: string,
  vdom: string = "root",
): Promise<IsdbLookupResponse> {
  const res = await authFetch(`${API_BASE}/api/tools/isdb/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device, target, vdom }),
  });
  if (!res.ok) {
    let detail = "ISDB lookup failed";
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* keep generic */
    }
    throw new Error(detail);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Tools — PAN XML extraction
// ---------------------------------------------------------------------------

export interface PanParser {
  id: string;
  label: string;
  description: string;
}

export interface PanExtractResult {
  status: string;
  parsers: { parser: string; status: string; files?: string[]; error?: string }[];
  files: string[];
  archive: string | null;
}

export interface JobStatus {
  job_id: string;
  status: "queued" | "in_progress" | "complete" | "not_found";
  result: PanExtractResult | null;
  error: string | null;
}

export async function fetchPanParsers(): Promise<PanParser[]> {
  const res = await authFetch(`${API_BASE}/api/tools/pan-xml/parsers`);
  if (!res.ok) throw new Error("Failed to fetch PAN parsers");
  const data = await res.json();
  return data.parsers;
}

export async function submitPanExtract(
  file: File,
  parserIds: string[]
): Promise<{ job_id: string; parsers: string[] }> {
  const form = new FormData();
  form.append("file", file);
  form.append("parsers", parserIds.join(","));
  const res = await authFetch(`${API_BASE}/api/tools/pan-xml/extract`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Failed to submit extraction job");
  }
  return res.json();
}

export async function fetchJobStatus(jobId: string): Promise<JobStatus> {
  const res = await authFetch(`${API_BASE}/api/jobs/${jobId}`);
  if (!res.ok) throw new Error("Failed to fetch job status");
  return res.json();
}

/**
 * Build an authenticated URL for downloading a job artifact. The frontend
 * can't set Authorization headers on a plain <a href> click, so we fetch the
 * file as a blob and trigger a synthetic download.
 */
export async function downloadJobArtifact(
  jobId: string,
  filename: string
): Promise<void> {
  const res = await authFetch(
    `${API_BASE}/api/jobs/${jobId}/artifact/${encodeURIComponent(filename)}`
  );
  if (!res.ok) throw new Error("Failed to download artifact");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Tools — Diff utility
// ---------------------------------------------------------------------------

export interface DiffLimits {
  max_file_bytes: number;
  max_total_bytes: number;
  max_file_count: number;
  min_file_count: number;
  allowed_extensions: string[];
}

export interface DiffFileMeta {
  name: string;
  size: number;
  sha256: string;
  format: "text" | "json" | "xml" | "yaml";
}

export interface DiffPair {
  index: number;
  name: string;
  unified: string;
  added: number;
  removed: number;
  truncated: boolean;
}

export interface DiffCompareResult {
  format: "text" | "json" | "xml" | "yaml";
  baseline_index: number;
  files: DiffFileMeta[];
  diffs: DiffPair[];
}

export async function fetchDiffLimits(): Promise<DiffLimits> {
  const res = await authFetch(`${API_BASE}/api/tools/diff/limits`);
  if (!res.ok) throw new Error("Failed to fetch diff limits");
  return res.json();
}

export async function submitDiffCompare(
  files: File[],
  baselineIndex: number,
): Promise<DiffCompareResult> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  form.append("baseline_index", String(baselineIndex));
  const res = await authFetch(`${API_BASE}/api/tools/diff/compare`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Diff failed");
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Tools — Policy viewer
// ---------------------------------------------------------------------------

export interface PolicyViewerPackages {
  adom: string;
  packages: string[];
}

export interface PolicyViewerPolicies {
  adom: string;
  package: string;
  count: number;
  policies: Record<string, unknown>[];
  fields: string[];
}

/**
 * FMG firewall-policy schema, returned by the ``syntax`` option on a
 * ``get`` against ``/pm/config/adom/{adom}/obj/firewall/policy``. Only
 * the fields we actually render are typed — everything else is reached
 * via ``Record<string, unknown>`` on ``PolicySchemaAttr.extra``.
 */
export interface PolicySchemaDataSrcRef {
  category: string;
  mkey: string;
}

export interface PolicySchemaAttr {
  type?: string;
  help?: string;
  default?: unknown;
  opts?: Record<string, number>;
  "opts help"?: Record<string, string>;
  ref?: PolicySchemaDataSrcRef[];
  excluded?: boolean;
  sz?: number;
  max?: number;
  max_argv?: number;
}

export interface PolicySchema {
  alimit?: number;
  category?: string;
  help?: string;
  mkey?: string;
  attr: Record<string, PolicySchemaAttr>;
}

export interface PolicyViewerSchemaResponse {
  adom: string;
  cached: boolean;
  schema: PolicySchema;
}

/**
 * Per-policyid runtime counters returned by the 3-step ``/sys/hitcount``
 * refresh flow. Timestamps are Unix epoch seconds.
 */
export interface PolicyHitcount {
  hitcount: number;
  pkts: number;
  byte: number;
  sesscount: number;
  first_hit: number;
  last_hit: number;
  first_session: number;
  last_session: number;
}

export interface PolicyViewerHitcountResponse {
  adom: string;
  package: string;
  count: number;
  hitcounts: Record<string, PolicyHitcount>;
  error?: string;
}

export interface FirewallAddress {
  name: string;
  type?: string | number;
  subnet?: unknown;
  "start-ip"?: string;
  "end-ip"?: string;
  fqdn?: string;
  wildcard?: unknown;
  country?: string | string[];
  macaddr?: unknown;
  "sub-type"?: string | number;
  sdn?: unknown;
  filter?: string;
  "route-tag"?: string | number;
  interface?: string | string[];
  "associated-interface"?: string | string[];
  comment?: string;
}

export interface FirewallAddrGrp {
  name: string;
  member?: unknown;
  comment?: string;
}

export interface FirewallService {
  name: string;
  protocol?: string | number;
  "tcp-portrange"?: unknown;
  "udp-portrange"?: unknown;
  "sctp-portrange"?: unknown;
  icmptype?: unknown;
  icmpcode?: unknown;
  comment?: string;
}

export interface FirewallServiceGroup {
  name: string;
  member?: unknown;
  comment?: string;
}

export interface PolicyObjectMap {
  adom: string;
  addresses: Record<string, FirewallAddress>;
  addrgrps: Record<string, FirewallAddrGrp>;
  services: Record<string, FirewallService>;
  service_groups: Record<string, FirewallServiceGroup>;
  counts: {
    addresses: number;
    addrgrps: number;
    services: number;
    service_groups: number;
  };
}

export async function fetchPolicyPackages(): Promise<PolicyViewerPackages> {
  const res = await authFetch(`${API_BASE}/api/tools/policy-viewer/packages`);
  if (!res.ok) throw new Error("Failed to fetch policy packages");
  return res.json();
}

export async function fetchPolicyList(
  packageName: string,
): Promise<PolicyViewerPolicies> {
  const path = packageName.split("/").map(encodeURIComponent).join("/");
  const res = await authFetch(
    `${API_BASE}/api/tools/policy-viewer/packages/${path}/policies`,
  );
  if (!res.ok) throw new Error("Failed to fetch policies");
  return res.json();
}

export async function fetchPolicyObjectMap(
  refresh = false,
): Promise<PolicyObjectMap> {
  const qs = refresh ? "?refresh=true" : "";
  const res = await authFetch(
    `${API_BASE}/api/tools/policy-viewer/objects${qs}`,
  );
  if (!res.ok) throw new Error("Failed to fetch object map");
  return res.json();
}

export async function fetchPolicyViewerSchema(
  refresh = false,
): Promise<PolicyViewerSchemaResponse> {
  const qs = refresh ? "?refresh=true" : "";
  const res = await authFetch(
    `${API_BASE}/api/tools/policy-viewer/schema${qs}`,
  );
  if (!res.ok) throw new Error("Failed to fetch policy schema");
  return res.json();
}

export async function fetchPolicyHitcounts(
  packageName: string,
): Promise<PolicyViewerHitcountResponse> {
  const path = packageName.split("/").map(encodeURIComponent).join("/");
  const res = await authFetch(
    `${API_BASE}/api/tools/policy-viewer/packages/${path}/hitcount`,
  );
  if (!res.ok) throw new Error("Failed to fetch policy hitcounts");
  return res.json();
}

// ---------------------------------------------------------------------------
// Tools — Policy shadow analyzer
// ---------------------------------------------------------------------------

export interface PolicyShadowPackages {
  adom: string;
  packages: string[];
}

export interface PolicyShadowRunRequest {
  packages: string[];
  package_regex: string | null;
  formats: ("html" | "xlsx" | "json")[];
  include_disabled: boolean;
}

export interface PolicyShadowRunResponse {
  job_id: string;
  adom: string;
  host: string;
  packages: string[];
  package_regex: string | null;
  formats: string[];
}

export interface PolicyShadowResult {
  status: "ok" | "error";
  exit_code: number | null;
  files: string[];
  html_report: string | null;
  stdout_tail: string;
  stderr_tail: string;
  error?: string;
}

export async function fetchPolicyShadowPackages(): Promise<PolicyShadowPackages> {
  const res = await authFetch(`${API_BASE}/api/tools/policy-shadow/packages`);
  if (!res.ok) throw new Error("Failed to fetch policy packages");
  return res.json();
}

export async function submitPolicyShadowRun(
  body: PolicyShadowRunRequest,
): Promise<PolicyShadowRunResponse> {
  const res = await authFetch(`${API_BASE}/api/tools/policy-shadow/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.detail || "Failed to start shadow analysis");
  }
  return res.json();
}

/**
 * Fetch a job artifact as text. Used for HTML reports that are rendered
 * into an iframe via `srcdoc` so the iframe gets a unique opaque origin
 * (safe to combine `allow-scripts` + `allow-same-origin`).
 */
export async function fetchJobArtifactText(
  jobId: string,
  filename: string,
): Promise<string> {
  const res = await authFetch(
    `${API_BASE}/api/jobs/${jobId}/artifact/${encodeURIComponent(filename)}`,
  );
  if (!res.ok) throw new Error("Failed to fetch artifact");
  return res.text();
}
