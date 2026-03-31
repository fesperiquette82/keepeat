import { buildApiUrl } from './config';

export interface BillingVerifyInput {
  platform: 'android';
  product_id: string;
  purchase_token: string;
}

export async function verifyPremiumPurchase(token: string, body: BillingVerifyInput): Promise<any> {
  const res = await fetch(buildApiUrl('/api/billing/google/verify'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.detail?.code ?? `verify_failed_${res.status}`);
  }
  return data;
}

export async function restorePremiumPurchase(token: string): Promise<any> {
  const res = await fetch(buildApiUrl('/api/billing/restore'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.detail?.code ?? `restore_failed_${res.status}`);
  }
  return data;
}
