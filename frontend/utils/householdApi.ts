import { buildApiUrl } from './config';
import { fetchWithTimeout as fetch } from './fetchWithTimeout';

export interface HouseholdMember {
  user_id: string;
  email: string;
  role: 'owner' | 'member';
}

export interface Household {
  id: string;
  name: string;
  owner_id: string;
  members: HouseholdMember[];
  created_at: string;
}

async function parseOrThrow(res: Response, fallbackCode: string): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.detail?.code ?? `${fallbackCode}_${res.status}`);
  }
  return data;
}

export async function fetchHousehold(token: string): Promise<Household | null> {
  const res = await fetch(buildApiUrl('/api/household'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  return parseOrThrow(res, 'household_fetch_failed');
}

export async function createHousehold(token: string, name: string): Promise<Household> {
  const res = await fetch(buildApiUrl('/api/household'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  return parseOrThrow(res, 'household_create_failed');
}

export async function inviteToHousehold(token: string): Promise<{ token: string; expires_at: string }> {
  const res = await fetch(buildApiUrl('/api/household/invite'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(res, 'household_invite_failed');
}

export async function joinHousehold(token: string, inviteToken: string): Promise<Household> {
  const res = await fetch(buildApiUrl('/api/household/join'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ token: inviteToken }),
  });
  return parseOrThrow(res, 'household_join_failed');
}

export async function leaveHousehold(token: string): Promise<void> {
  const res = await fetch(buildApiUrl('/api/household/leave'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.detail?.code ?? `household_leave_failed_${res.status}`);
  }
}
