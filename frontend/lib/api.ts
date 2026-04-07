const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
}

export interface PinnedFieldsResponse {
  profile_type: string;
  pinned_fields: string[];
}

export async function fetchProfileTypes(): Promise<ProfileType[]> {
  const res = await fetch(`${API_BASE}/api/profiles/types`);
  if (!res.ok) throw new Error("Failed to fetch profile types");
  return res.json();
}

export async function fetchProfiles(type: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/profiles/${type}`);
  if (!res.ok) throw new Error("Failed to fetch profiles");
  const data = await res.json();
  return data.profiles;
}

export async function compareProfiles(
  type: string,
  names: string[]
): Promise<ComparisonResponse> {
  const params = names.map((n) => `name=${encodeURIComponent(n)}`).join("&");
  const res = await fetch(`${API_BASE}/api/profiles/${type}/compare?${params}`);
  if (!res.ok) throw new Error("Failed to compare profiles");
  return res.json();
}

export async function fetchPins(type: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/profiles/${type}/pins`);
  if (!res.ok) throw new Error("Failed to fetch pins");
  const data: PinnedFieldsResponse = await res.json();
  return data.pinned_fields;
}

export async function togglePin(
  type: string,
  fieldPath: string,
  pinned: boolean
): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/profiles/${type}/pins`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_type: type, field_path: fieldPath, pinned }),
  });
  if (!res.ok) throw new Error("Failed to toggle pin");
  const data: PinnedFieldsResponse = await res.json();
  return data.pinned_fields;
}
