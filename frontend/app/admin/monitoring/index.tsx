import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { AdminMonitoringNav } from '../../../component/admin/AdminMonitoringNav';
import {
  AdminScaffold,
  AdminSectionCard,
  EmptyState,
  ErrorState,
  formatDate,
  formatMoney,
  KpiCard,
  LoadingState,
  StatusBadge,
} from '../../../component/admin/AdminUi';
import { getMonitoringDashboard, getMonitoringHealth, MonitoringDashboardResponse, MonitoringHealthResponse } from '../../../utils/adminMonitoringApi';
import { useAuthStore } from '../../../store/authStore';

export default function AdminMonitoringDashboardScreen() {
  const [health, setHealth] = useState<MonitoringHealthResponse | null>(null);
  const [dashboard, setDashboard] = useState<MonitoringDashboardResponse | null>(null);
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
        const [healthData, dashboardData] = await Promise.all([
          getMonitoringHealth(token, controller.signal),
          getMonitoringDashboard(token, controller.signal),
        ]);
        setHealth(healthData);
        setDashboard(dashboardData);
      } catch (e: any) {
        setError(e?.message || 'Chargement impossible');
      } finally {
        setLoading(false);
      }
    };
    run();
    return () => controller.abort();
  }, [token]);

  return (
    <AdminScaffold title="Admin Monitoring">
      <AdminMonitoringNav />
      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} />}
      {!loading && !error && !health && <EmptyState label="Aucune donnée de santé." />}
      {!loading && !error && health && dashboard && (
        <>
          <AdminSectionCard title="État global">
            <StatusBadge status={health.status || 'unknown'} />
            <Text>DB: {health.db?.ok ? 'OK' : 'Down'}</Text>
            <Text>Uptime: {health.uptime_seconds ?? 0}s</Text>
            <Text>Dernière erreur critique: {formatDate(health.last_critical_error?.created_at)}</Text>
          </AdminSectionCard>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <KpiCard label="Total users" value={dashboard.users?.total ?? 0} />
            <KpiCard label="DAU" value={dashboard.users?.dau ?? 0} />
            <KpiCard label="Free / Premium" value={`${dashboard.users?.free ?? 0} / ${dashboard.users?.premium ?? 0}`} />
            <KpiCard label="Active subscriptions" value={String(dashboard.subscriptions?.active ?? 0)} />
            <KpiCard label="Estimated MRR" value={formatMoney(Number(dashboard.subscriptions?.estimated_mrr_eur ?? 0))} />
          </View>

          <AdminSectionCard title="Top API issues">
            {(dashboard.top_api_issues || []).slice(0, 5).map((row, idx) => (
              <Text key={`${row.endpoint_key || idx}`}>• {String(row.endpoint_key || 'unknown')} — {String(row.error_rate || 0)}</Text>
            ))}
            {(!dashboard.top_api_issues || dashboard.top_api_issues.length === 0) && <EmptyState label="Aucune anomalie API." />}
          </AdminSectionCard>

          <AdminSectionCard title="Top service usage">
            {(dashboard.top_service_usage || []).slice(0, 5).map((row, idx) => (
              <Text key={`${row.service_name || idx}`}>• {String(row.service_name || 'service')} — coût {formatMoney(Number(row.estimated_cost || 0))}</Text>
            ))}
            {(!dashboard.top_service_usage || dashboard.top_service_usage.length === 0) && <EmptyState label="Aucun usage de service." />}
            <Text>
              Coût total estimé: {formatMoney(Number(dashboard.estimated_cost_summary?.services_30d_estimated_cost_eur ?? 0))}
            </Text>
          </AdminSectionCard>
        </>
      )}
    </AdminScaffold>
  );
}
