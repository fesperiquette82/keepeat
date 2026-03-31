import React, { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { AdminMonitoringNav } from '../../../component/admin/AdminMonitoringNav';
import { AdminScaffold, AdminSectionCard, EmptyState, ErrorState, formatMs, formatPct, KpiCard, LoadingState } from '../../../component/admin/AdminUi';
import { buildPeriodParams, getMonitoringApis, MonitoringApisResponse } from '../../../utils/adminMonitoringApi';
import { useAuthStore } from '../../../store/authStore';

const PERIODS: ('24h' | '7d' | '30d')[] = ['24h', '7d', '30d'];

export default function AdminMonitoringApisScreen() {
  const [period, setPeriod] = useState<'24h' | '7d' | '30d'>('7d');
  const [data, setData] = useState<MonitoringApisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

          <AdminSectionCard title="Top endpoints">
            {data.top_endpoints.map((row) => (
              <Text key={row.endpoint_key}>
                • {row.endpoint_key} — vol {row.volume} | err {formatPct(row.error_rate)} | avg {formatMs(row.avg_latency_ms)} | p95 {formatMs(row.p95_latency_ms)}
              </Text>
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
