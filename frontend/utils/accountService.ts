import { buildApiUrl } from './config';
import { fetchWithTimeout as fetch } from './fetchWithTimeout';

export interface AccountExportPayload {
  generated_at: string;
  account: Record<string, unknown>;
  stock_items: Record<string, unknown>[];
  receipt_tickets: Record<string, unknown>[];
}

export async function exportAccountData(token: string): Promise<AccountExportPayload> {
  const res = await fetch(buildApiUrl('/api/account/export'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.detail ?? `export_failed_${res.status}`);
  }
  return data as AccountExportPayload;
}

export async function deleteAccount(token: string, confirmPassword: string): Promise<void> {
  const res = await fetch(buildApiUrl('/api/account'), {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ confirm_password: confirmPassword }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `delete_failed_${res.status}`);
  }
}
