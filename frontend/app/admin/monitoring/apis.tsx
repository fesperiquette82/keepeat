import React, { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { AdminMonitoringNav } from '../../../component/admin/AdminMonitoringNav';
import { AdminScaffold, AdminSectionCard, EmptyState, ErrorState, formatDate, formatMs, formatPct, KpiCard, LoadingState } from '../../../component/admin/AdminUi';
import {
  buildPeriodParams,
  getMonitoringApiDrill,
  getMonitoringApis,
  MonitoringApiDrillResponse,
  MonitoringApisResponse,
} from '../../../utils/adminMonitoringApi';
import { useAuthStore } from '../../../store/authStore';

const PERIODS: ('24h' | '7d' | '30d')[] = ['24h', '7d', '30d'];

function ApiDrillDown({ endpointKey, token }: { endpointKey: string; token: string }) {
  const [drill, setDrill] = useState<MonitoringApiDrillResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await getMonitoringApiDrill(token, { endpoint_key: endpointKey, days: 7 }, controller.signal);
        setDrill(response);
      } catch (e: any) {
        setError(e?.message || 'Chargement impossible');
      } finally {
        setLoading(false);
      }
    };
    run();
    return () => controller.abort();
  }, [endpointKey, token]);

  if (loading) return <LoadingState label="Détail..." />;
  if (error) return <ErrorState message={error} />;
  if (!drill) return null;

  return (
    <View style={{ paddingLeft: 12, gap: 4, marginBottom: 8 }}>
      <Text>Total appels (7j): {drill.total_calls}</Text>
      {drill.by_status.map((row) => (
        <Text key={row.status_code}>• HTTP {row.status_code}: {row.count} (avg {formatMs(row.avg_ms)})</Text>
      ))}
      {drill.last_errors.length > 0 && <Text style={{ fontWeight: '700', marginTop: 4 }}>Dernières erreurs</Text>}
      {drill.last_errors.map((err, idx) => (
        <Text key={idx} numberOfLines={1}>• {formatDate(err.created_at)} — {err.method} {err.path} → {err.status_code} ({err.error_type || 'inconnu'})</Text>
      ))}
    </View>
  );
}

export default function AdminMonitoringApisScreen() {
  const [period, setPeriod] = useState<'24h' | '7d' | '30d'>('7d');
  const [data, setData] = useState<MonitoringApisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedEndpoint, setExpandedEndpoint] = useState<string | null>(null);
  const token = useAuthStore((state) => state.token);

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        if (!token) throw new Error('Session expirée');
        const params = buildPeriodParams(period);
        const response = await getMonitoringApis(token, { ...params, limit: 25 }, controller.signal);
        setData(response);
      } catch (e: any) {
        setError(e?.message || 'Chargement impossible');
      } finally {
        setLoading(false);
      }
    };
    run();
    return () => controller.abort();
  }, [period, token]);

  const averageLatency = useMemo(() => {
    const rows = data?.top_endpoints || [];
    if (rows.length === 0) return 0;
    return rows.reduce((sum, row) => sum + row.avg_latency_ms, 0) / rows.length;
  }, [data]);

  return (
    <AdminScaffold title="Admin Monitoring — APIs">
      <AdminMonitoringNav />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {PERIODS.map((p) => (
          <TouchableOpacity key={p} onPress={() => setPeriod(p)} style={{ backgroundColor: period === p ? '#DCFCE7' : '#fff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 }}>
            <Text>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <KpiCard label="Volume" value={data.volume} />
            <KpiCard label="Endpoints" value={data.top_endpoints.length} />
            <KpiCard label="Avg latency" value={formatMs(averageLatency)} />
          </View>

          <AdminSectionCard title="Top endpoints (toucher pour le détail)">
            {data.top_endpoints.map((row) => (
              <View key={row.endpoint_key}>
                <TouchableOpacity onPress={() => setExpandedEndpoint(expandedEndpoint === row.endpoint_key ? null : row.endpoint_key)}>
                  <Text>
                    {expandedEndpoint === row.endpoint_key ? '▾' : '▸'} {row.endpoint_key} — vol {row.volume} | err {formatPct(row.error_rate)} | avg {formatMs(row.avg_latency_ms)} | p95 {formatMs(row.p95_latency_ms)}
                  </Text>
                </TouchableOpacity>
                {expandedEndpoint === row.endpoint_key && token && <ApiDrillDown endpointKey={row.endpoint_key} token={token} />}
              </View>
            ))}
            {data.top_endpoints.length === 0 && <EmptyState label="Aucun endpoint sur cette période." />}
          </AdminSectionCard>

          <AdminSectionCard title="Endpoints en erreur">
            {data.highest_error_rate.map((row) => (
              <Text key={row.endpoint_key}>• {row.endpoint_key} — {formatPct(row.error_rate)} ({row.volume} req)</Text>
            ))}
            {data.highest_error_rate.length === 0 && <EmptyState label="Aucune erreur." />}
          </AdminSectionCard>

          <AdminSectionCard title="Endpoints lents (p95)">
            {data.highest_latency.map((row) => (
              <Text key={row.endpoint_key}>• {row.endpoint_key} — p95 {formatMs(row.p95_latency_ms)} / avg {formatMs(row.avg_latency_ms)}</Text>
            ))}
            {data.highest_latency.length === 0 && <EmptyState label="Aucune latence élevée." />}
          </AdminSectionCard>
        </>
      )}
    </AdminScaffold>
  );
}
