import { buildApiUrl } from './config';
import { fetchWithTimeout as fetch } from './fetchWithTimeout';

export interface GmailAuthUrl {
  authorization_url: string;
  state: string;
}

export interface GmailConnectionStatus {
  connected: boolean;
  connected_at: string | null;
  status: 'connected' | 'disconnected' | 'error';
}

async function parseOrThrow(res: Response, fallbackCode: string): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.detail?.code ?? `${fallbackCode}_${res.status}`);
  }
  return data;
}

export async function fetchGmailAuthUrl(token: string): Promise<GmailAuthUrl> {
  const res = await fetch(buildApiUrl('/api/integrations/gmail/auth-url'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(res, 'gmail_auth_url_failed');
}

export async function connectGmail(token: string, code: string, state: string): Promise<GmailConnectionStatus> {
  const res = await fetch(buildApiUrl('/api/integrations/gmail/connect'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code, state }),
  });
  return parseOrThrow(res, 'gmail_connect_failed');
}

export async function fetchGmailStatus(token: string): Promise<GmailConnectionStatus> {
  const res = await fetch(buildApiUrl('/api/integrations/gmail/status'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(res, 'gmail_status_failed');
}

export async function disconnectGmail(token: string): Promise<GmailConnectionStatus> {
  const res = await fetch(buildApiUrl('/api/integrations/gmail/disconnect'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(res, 'gmail_disconnect_failed');
}
