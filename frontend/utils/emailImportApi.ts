import { buildApiUrl } from './config';
import { fetchWithTimeout as fetch } from './fetchWithTimeout';

export interface EmailImportAddress {
  configured: boolean;
  address: string | null;
}

async function parseOrThrow(res: Response, fallbackCode: string): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.detail?.code ?? `${fallbackCode}_${res.status}`);
  }
  return data;
}

export async function fetchEmailImportAddress(token: string): Promise<EmailImportAddress> {
  const res = await fetch(buildApiUrl('/api/integrations/email-import/address'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(res, 'email_import_address_failed');
}
