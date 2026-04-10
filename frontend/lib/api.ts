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
}

export interface ComparisonResponse {
  profile_type: string;
  profile_names: string[];
  fields: ComparisonField[];
  collection_keys: string[];
  raw_profiles: Record<string, Record<string, unknown>>;
  defaults: Record<string, unknown>;
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
  names: string[]
): Promise<ComparisonResponse> {
  const params = names.map((n) => `name=${encodeURIComponent(n)}`).join("&");
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
