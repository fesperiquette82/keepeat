import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { buildApiUrl } from '../config';

export type DiagnosticStatus = 'ok' | 'warn' | 'error';

export interface DiagnosticCheckResult {
  key: string;
  label: string;
  status: DiagnosticStatus;
  ok: boolean;
  durationMs: number;
  summary: string;
  details: string;
  error: string | null;
  timestamp: string;
}

export interface DiagnosticContext {
  token: string | null;
  pendingMutationsCount: number;
  isOnline: boolean;
}

interface DiagnosticCheckDefinition {
  key: string;
  label: string;
  run: (ctx: DiagnosticContext) => Promise<Omit<DiagnosticCheckResult, 'key' | 'label' | 'durationMs' | 'timestamp'>>;
}

const DIAG_CACHE_KEY = 'keepeat:diagnostic:ping';
const REQUEST_TIMEOUT_MS = 8000;

function sanitizeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function fetchWithTimeout(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(buildApiUrl(path), { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const CHECKS_REGISTRY: DiagnosticCheckDefinition[] = [
  {
    key: 'backend_main',
    label: 'Backend principal',
    run: async () => {
      const res = await fetchWithTimeout('/api/health');
      if (!res.ok) {
        return { status: 'error', ok: false, summary: 'Health endpoint indisponible', details: `HTTP ${res.status}`, error: `http_${res.status}` };
      }
      return { status: 'ok', ok: true, summary: 'Backend joignable', details: 'GET /api/health OK', error: null };
    },
  },
  {
    key: 'auth_session',
    label: 'Auth / session',
    run: async (ctx) => {
      if (!ctx.token) {
        return { status: 'warn', ok: false, summary: 'Session absente', details: 'Aucun token en mémoire', error: 'no_session_token' };
      }
      const res = await fetchWithTimeout('/api/stats', { headers: authHeaders(ctx.token) });
      if (!res.ok) {
        return { status: 'error', ok: false, summary: 'Session invalide ou expirée', details: `GET /api/stats -> HTTP ${res.status}`, error: `http_${res.status}` };
      }
      return { status: 'ok', ok: true, summary: 'Session valide', details: 'Endpoint authentifié accessible', error: null };
    },
  },
  {
    key: 'stock_sync',
    label: 'Synchronisation stock',
    run: async (ctx) => {
      if (!ctx.token) {
        return { status: 'warn', ok: false, summary: 'Sync non testable', details: 'Nécessite une session utilisateur', error: 'missing_token' };
      }
      const res = await fetchWithTimeout('/api/stock?status=active', { headers: authHeaders(ctx.token) });
      if (!res.ok) {
        return { status: 'error', ok: false, summary: 'Sync stock en échec', details: `GET /api/stock -> HTTP ${res.status}`, error: `http_${res.status}` };
      }
      return { status: ctx.pendingMutationsCount > 0 ? 'warn' : 'ok', ok: true, summary: 'Flux stock accessible', details: ctx.pendingMutationsCount > 0 ? `${ctx.pendingMutationsCount} mutation(s) en attente` : 'Aucune mutation en attente', error: null };
    },
  },
  {
    key: 'recalls_updates',
    label: 'Mise à jour rappels produits',
    run: async (ctx) => {
      if (!ctx.token) {
        return { status: 'warn', ok: false, summary: 'Check rappel ignoré', details: 'Nécessite une session utilisateur', error: 'missing_token' };
      }
      const res = await fetchWithTimeout('/api/recalls/status', { headers: authHeaders(ctx.token) });
      if (!res.ok) {
        return { status: 'error', ok: false, summary: 'Service rappels indisponible', details: `GET /api/recalls/status -> HTTP ${res.status}`, error: `http_${res.status}` };
      }
      return { status: 'ok', ok: true, summary: 'Rappels accessibles', details: 'Statut rappels récupéré', error: null };
    },
  },
  {
    key: 'recipes_suggestions',
    label: 'Suggestions recettes',
    run: async (ctx) => {
      if (!ctx.token) {
        return { status: 'warn', ok: false, summary: 'Check recettes ignoré', details: 'Nécessite une session utilisateur', error: 'missing_token' };
      }
      const res = await fetchWithTimeout('/api/recipes/suggestions?filter=personalized', { headers: authHeaders(ctx.token) });
      if (!res.ok) {
        return { status: 'error', ok: false, summary: 'Suggestions indisponibles', details: `GET /api/recipes/suggestions -> HTTP ${res.status}`, error: `http_${res.status}` };
      }
      return { status: 'ok', ok: true, summary: 'Suggestions accessibles', details: 'Endpoint suggestions répond', error: null };
    },
  },
  {
    key: 'local_cache',
    label: 'Cache / persistance locale',
    run: async () => {
      const probe = `${Date.now()}`;
      await AsyncStorage.setItem(DIAG_CACHE_KEY, probe);
      const value = await AsyncStorage.getItem(DIAG_CACHE_KEY);
      if (value !== probe) {
        return { status: 'error', ok: false, summary: 'Persistance locale incohérente', details: 'Lecture/écriture AsyncStorage invalide', error: 'storage_mismatch' };
      }
      return { status: 'ok', ok: true, summary: 'Persistance locale OK', details: 'Lecture/écriture AsyncStorage valide', error: null };
    },
  },
  {
    key: 'network_connectivity',
    label: 'Connectivité réseau',
    run: async (ctx) => {
      const state = await NetInfo.fetch();
      const connected = !!(state.isConnected && state.isInternetReachable !== false);
      if (!connected) {
        return { status: 'error', ok: false, summary: 'Pas de connectivité internet', details: `isConnected=${String(state.isConnected)} isInternetReachable=${String(state.isInternetReachable)}`, error: 'offline' };
      }
      return { status: ctx.isOnline ? 'ok' : 'warn', ok: true, summary: 'Connectivité réseau détectée', details: `Store online=${String(ctx.isOnline)}`, error: null };
    },
  },
];

export function getDiagnosticChecksRegistry(): ReadonlyArray<{ key: string; label: string }> {
  return CHECKS_REGISTRY.map(({ key, label }) => ({ key, label }));
}

export async function runAllDiagnosticChecks(context: DiagnosticContext): Promise<DiagnosticCheckResult[]> {
  const results: DiagnosticCheckResult[] = [];
  for (const check of CHECKS_REGISTRY) {
    const started = Date.now();
    try {
      const payload = await check.run(context);
      results.push({
        key: check.key,
        label: check.label,
        durationMs: Date.now() - started,
        timestamp: new Date().toISOString(),
        ...payload,
      });
    } catch (err) {
      results.push({
        key: check.key,
        label: check.label,
        status: 'error',
        ok: false,
        durationMs: Date.now() - started,
        summary: 'Check en exception',
        details: 'Erreur pendant l’exécution du check',
        error: sanitizeError(err),
        timestamp: new Date().toISOString(),
      });
    }
  }
  return results;
}
