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
    localStorage.removeItem("fmg_host");
    window.location.href = "/login";
    throw new Error("Session expired");
  }
  return res;
}

export async function login(
  host: string,
  username: string,
  password: string
): Promise<{ token: string; username: string; host: string }> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host, username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Authentication failed");
  }
  const data = await res.json();
  localStorage.setItem("fmg_token", data.token);
  localStorage.setItem("fmg_user", data.username);
  localStorage.setItem("fmg_host", data.host);
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
  localStorage.removeItem("fmg_host");
}

export async function verifySession(): Promise<{
  valid: boolean;
  username?: string;
}> {
  const token = getToken();
  if (!token) return { valid: false };
  try {
    const res = await fetch(`${API_BASE}/api/auth/verify`, {
      headers: authHeaders(),
    });
    if (!res.ok) return { valid: false };
    const data = await res.json();
    return { valid: true, username: data.username };
  } catch {
    return { valid: false };
  }
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
