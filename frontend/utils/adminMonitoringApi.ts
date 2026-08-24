import { buildApiUrl } from './config';
import { fetchWithTimeout as fetch } from './fetchWithTimeout';

export interface MonitoringHealthResponse {
  status: 'ok' | 'degraded' | 'error' | string;
  db?: { ok: boolean };
  external_services?: Record<string, boolean>;
  uptime_seconds?: number;
  generated_at?: string;
  last_critical_error?: {
    method?: string;
    path?: string;
    status_code?: number;
    created_at?: string;
    error_type?: string;
  } | null;
}

export interface MonitoringDashboardResponse {
  generated_at: string;
  users: Record<string, number>;
  subscriptions: Record<string, unknown>;
  top_api_issues: Array<Record<string, unknown>>;
  top_service_usage: Array<Record<string, unknown>>;
  estimated_cost_summary?: Record<string, number>;
  operational_status?: string;
  operational_status_reasons?: string[];
  critical_flows?: Record<string, {
    endpoint_key: string;
    calls: number;
    success: number;
    errors: number;
    error_rate: number;
    avg_latency_ms: number;
    severity: 'ok' | 'degraded' | 'critical' | string;
    label: string;
    business_criticality?: string;
  }>;
  product_funnel?: {
    users_with_receipt_scan?: number;
    users_with_stock_add?: number;
    users_with_recipes_view?: number;
    premium_conversion_rate?: number;
  };
  activation_funnel?: {
    registered: number;
    added_product: number;
    scanned_receipt: number;
    viewed_paywall: number;
    purchased: number;
    rates: {
      added_product: number;
      scanned_receipt: number;
      viewed_paywall: number;
      purchased: number;
    };
  };
  crash_reports?: {
    total: number;
    recent: Array<{
      message?: string;
      screen?: string;
      platform?: string;
      app_version?: string;
      created_at?: string;
    }>;
  };
  cost_metrics?: {
    ocr_cost_eur: number;
    ocr_cost_per_scan_eur?: number | null;
    cost_per_active_user_eur?: number | null;
    estimated_net_revenue_eur: number;
  };
  email_import_overview?: {
    total: number;
    succeeded: number;
    by_outcome: Record<string, number>;
  };
  external_service_quotas?: {
    generated_at?: string;
    services?: Array<{
      service_key: string;
      display_name: string;
      category?: string;
      enabled?: boolean;
      configured?: boolean;
      free_tier_limited?: boolean;
      quota_limit_value?: number | null;
      quota_period?: string | null;
      quota_unit?: string | null;
      usage_current_period?: number | null;
      usage_remaining?: number | null;
      usage_percent?: number | null;
      source_of_truth?: string;
      usage_window?: string;
      pricing_note?: string | null;
      upgrade_note?: string | null;
      status?: 'ok' | 'warning' | 'critical' | 'unknown' | string;
    }>;
    comparison_chart?: Array<{
      service_key: string;
      display_name: string;
      capacity_max?: number | null;
      capacity_used?: number | null;
      capacity_remaining?: number | null;
      usage_percent?: number | null;
      status?: string;
    }>;
    notes?: Record<string, string>;
  };
}

export interface MonitoringApisResponse {
  volume: number;
  top_endpoints: Array<{
    endpoint_key: string;
    volume: number;
    error_rate: number;
    avg_latency_ms: number;
    p95_latency_ms: number;
  }>;
  highest_error_rate: Array<{
    endpoint_key: string;
    error_rate: number;
    volume: number;
  }>;
  highest_latency: Array<{
    endpoint_key: string;
    p95_latency_ms: number;
    avg_latency_ms: number;
  }>;
}

export interface MonitoringUsersResponse {
  generated_at: string;
  total?: number;
  new_today?: number;
  new_7d?: number;
  new_30d?: number;
  dau?: number;
  wau?: number;
  mau?: number;
  free?: number;
  premium?: number;
}

export interface MonitoringSubscriptionsResponse {
  generated_at: string;
  active_subscriptions: number;
  subscriptions_by_plan: Record<string, number>;
  inactive_or_expired?: number;
  estimated_mrr_eur?: number;
  estimated_arr_eur?: number;
}

export interface MonitoringServicesUsageResponse {
  total_estimated_cost: number;
  services: Array<{
    service_name: string;
    units: number;
    estimated_cost: number;
    calls: number;
    plans?: Record<string, { units: number; estimated_cost: number; calls: number }>;
    actions?: Array<{
      action_name: string;
      units: number;
      estimated_cost: number;
      calls: number;
      plan_type: string;
    }>;
  }>;
}

export interface MonitoringServiceStatusResponse {
  generated_at: string;
  uptime_seconds?: number;
  services: Array<{
    id: string;
    name: string;
    type: 'internal' | 'external' | 'local' | string;
    category?: string;
    status: 'connected' | 'degraded' | 'down' | 'not_configured' | 'unknown' | string;
    latency_ms?: number | null;
    last_checked_at?: string;
    message?: string;
    configured: boolean;
    details?: Record<string, unknown>;
  }>;
}

export interface MonitoringUsageResponse {
  generated_at: string;
  period?: { start?: string; end?: string; label?: string };
  usage: Array<{
    service_id: string;
    label: string;
    current_usage: number;
    projected_month_end_usage?: number | null;
    free_quota?: number | null;
    usage_percent?: number | null;
    period: string;
    warning_level: 'normal' | 'warning' | 'critical' | string;
    confidence?: 'low' | 'medium' | 'high' | string;
    is_estimated?: boolean;
    note?: string | null;
  }>;
}

export interface MonitoringCostsResponse {
  generated_at: string;
  pricing_note?: string;
  costs: Array<{
    service_id: string;
    current_plan: string;
    estimated_monthly_usage: number;
    recommended_next_plan: string;
    estimated_monthly_cost: number;
    currency: string;
    recommendation_reason: string;
    confidence: 'low' | 'medium' | 'high' | string;
    is_estimated: boolean;
  }>;
}

export interface MonitoringTrendsResponse {
  generated_at: string;
  days: number;
  dau: Array<{ date: string; count: number }>;
  new_users: Array<{ date: string; count: number }>;
  errors: Array<{ date: string; count: number }>;
  costs: Array<{ date: string; cost: number }>;
}

export interface MonitoringApiDrillResponse {
  endpoint_key: string;
  days: number;
  total_calls: number;
  by_status: Array<{ status_code: number; count: number; avg_ms: number }>;
  last_errors: Array<{
    id?: string;
    method?: string;
    path?: string;
    status_code?: number;
    duration_ms?: number;
    error_type?: string;
    created_at?: string;
  }>;
}

export interface MonitoringEventsResponse {
  page: number;
  page_size: number;
  total: number;
  events: Array<{
    id: string;
    event_name: string;
    event_category: string;
    user_id?: string | null;
    metadata_json?: Record<string, unknown>;
    created_at: string;
  }>;
}

function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, String(value));
  });
  const output = query.toString();
  return output ? `?${output}` : '';
}

async function adminGet<T>(path: string, token: string, signal?: AbortSignal): Promise<T> {
  if (!token?.trim()) {
    throw new Error('AUTH_TOKEN_MISSING');
  }
  const response = await fetch(buildApiUrl(path), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('AUTH_REQUIRED');
    }
    if (response.status === 403) {
      throw new Error('ACCESS_DENIED');
    }
    const detail = typeof data?.detail === 'string' ? data.detail : JSON.stringify(data?.detail ?? data);
    throw new Error(detail || `ADMIN_API_ERROR_${response.status}`);
  }
  return data as T;
}

export function buildPeriodParams(period: '24h' | '7d' | '30d' | 'custom', customStart?: string, customEnd?: string) {
  const now = new Date();
  const end = now.toISOString();
  if (period === 'custom') {
    return {
      start_date: customStart,
      end_date: customEnd || end,
    };
  }
  const hours = period === '24h' ? 24 : period === '7d' ? 24 * 7 : 24 * 30;
  const start = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
  return {
    start_date: start,
    end_date: end,
  };
}

export async function getMonitoringHealth(token: string, signal?: AbortSignal) {
  return adminGet<MonitoringHealthResponse>('/api/admin/monitoring/health', token, signal);
}

export async function getMonitoringDashboard(token: string, signal?: AbortSignal) {
  return adminGet<MonitoringDashboardResponse>('/api/admin/monitoring/dashboard', token, signal);
}

export async function getMonitoringApis(token: string, options: { start_date?: string; end_date?: string; limit?: number }, signal?: AbortSignal) {
  return adminGet<MonitoringApisResponse>(
    `/api/admin/monitoring/apis${buildQuery(options)}`,
    token,
    signal,
  );
}

export async function getMonitoringUsers(token: string, signal?: AbortSignal) {
  return adminGet<MonitoringUsersResponse>('/api/admin/monitoring/users', token, signal);
}

export async function getMonitoringSubscriptions(token: string, signal?: AbortSignal) {
  return adminGet<MonitoringSubscriptionsResponse>('/api/admin/monitoring/subscriptions', token, signal);
}

export async function getMonitoringServicesUsage(token: string, options: { start_date?: string; end_date?: string }, signal?: AbortSignal) {
  return adminGet<MonitoringServicesUsageResponse>(
    `/api/admin/monitoring/services-usage${buildQuery(options)}`,
    token,
    signal,
  );
}

export async function getMonitoringEvents(
  token: string,
  options: { start_date?: string; end_date?: string; page?: number; page_size?: number; event_name?: string; event_category?: string },
  signal?: AbortSignal,
) {
  return adminGet<MonitoringEventsResponse>(`/api/admin/monitoring/events${buildQuery(options)}`, token, signal);
}

export async function getMonitoringServiceStatus(token: string, signal?: AbortSignal) {
  return adminGet<MonitoringServiceStatusResponse>('/api/admin/monitoring/services', token, signal);
}

export async function getMonitoringUsage(token: string, signal?: AbortSignal) {
  return adminGet<MonitoringUsageResponse>('/api/admin/monitoring/usage', token, signal);
}

export async function getMonitoringCosts(token: string, signal?: AbortSignal) {
  return adminGet<MonitoringCostsResponse>('/api/admin/monitoring/costs', token, signal);
}

export async function getMonitoringTrends(token: string, options: { days?: number }, signal?: AbortSignal) {
  return adminGet<MonitoringTrendsResponse>(`/api/admin/monitoring/trends${buildQuery(options)}`, token, signal);
}

export async function getMonitoringApiDrill(
  token: string,
  options: { endpoint_key: string; days?: number },
  signal?: AbortSignal,
) {
  return adminGet<MonitoringApiDrillResponse>(`/api/admin/monitoring/api-drill${buildQuery(options)}`, token, signal);
}
