import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AdminMonitoringNav } from '../../../component/admin/AdminMonitoringNav';
import {
  AdminScaffold,
  AdminSectionCard,
  EmptyState,
  ErrorState,
  formatDate,
  formatMoney,
  formatPct,
  KpiCard,
  LoadingState,
  StatusBadge,
} from '../../../component/admin/AdminUi';
import { getMonitoringDashboard, getMonitoringHealth, MonitoringDashboardResponse, MonitoringHealthResponse } from '../../../utils/adminMonitoringApi';
import { useAuthStore } from '../../../store/authStore';



function quotaPeriodLabel(period?: string | null) {
  if (!period) return 'unknown';
  if (period === 'day') return 'par jour';
  if (period === 'month') return 'par mois';
  return `sur ${period}`;
}

function quotaStatusLabel(status?: string) {
  if (status === 'ok') return 'ok';
  if (status === 'warning') return 'warning';
  if (status === 'critical') return 'critical';
  return 'unknown';
}

function quotaStatusColor(status?: string) {
  if (status === 'critical') return '#DC2626';
  if (status === 'warning') return '#D97706';
  if (status === 'ok') return '#16A34A';
  return '#6B7280';
}

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
            {(dashboard.operational_status_reasons || []).map((reason, idx) => (
              <Text key={idx} style={{ color: '#B45309', fontSize: 12 }}>⚠ {reason}</Text>
            ))}
          </AdminSectionCard>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <KpiCard label="Total users" value={dashboard.users?.total ?? 0} />
            <KpiCard label="DAU" value={dashboard.users?.dau ?? 0} />
            <KpiCard label="Free / Premium" value={`${dashboard.users?.free ?? 0} / ${dashboard.users?.premium ?? 0}`} />
            <KpiCard label="Active subscriptions" value={String(dashboard.subscriptions?.active ?? 0)} />
            <KpiCard label="Estimated MRR" value={formatMoney(Number(dashboard.subscriptions?.estimated_mrr_eur ?? 0))} />
            <KpiCard label="Conversion premium" value={formatPct(dashboard.product_funnel?.premium_conversion_rate ?? 0)} />
          </View>

          <AdminSectionCard title="Entonnoir d'activation">
            {dashboard.activation_funnel && dashboard.activation_funnel.registered > 0 ? (
              <>
                <Text>Inscrits sur la période: {dashboard.activation_funnel.registered}</Text>
                <Text>• Ont ajouté un produit: {dashboard.activation_funnel.added_product} ({formatPct(dashboard.activation_funnel.rates.added_product)})</Text>
                <Text>• Ont scanné un ticket: {dashboard.activation_funnel.scanned_receipt} ({formatPct(dashboard.activation_funnel.rates.scanned_receipt)})</Text>
                <Text>• Ont vu le paywall: {dashboard.activation_funnel.viewed_paywall} ({formatPct(dashboard.activation_funnel.rates.viewed_paywall)})</Text>
                <Text>• Ont acheté: {dashboard.activation_funnel.purchased} ({formatPct(dashboard.activation_funnel.rates.purchased)})</Text>
              </>
            ) : (
              <EmptyState label="Aucun inscrit sur cette période." />
            )}
          </AdminSectionCard>

          <AdminSectionCard title="Flux critiques">
            {Object.values(dashboard.critical_flows || {}).map((flow) => (
              <View key={flow.endpoint_key} style={{ marginBottom: 6 }}>
                <Text>
                  {flow.severity !== 'ok' ? '⚠ ' : '• '}
                  {flow.label} ({flow.endpoint_key}) — {flow.calls} appels, {formatPct(flow.error_rate)} d&apos;erreurs, {Math.round(flow.avg_latency_ms)}ms
                </Text>
              </View>
            ))}
            {Object.keys(dashboard.critical_flows || {}).length === 0 && <EmptyState label="Aucun flux critique suivi." />}
          </AdminSectionCard>

          <AdminSectionCard title="Import de tickets par email">
            {dashboard.email_import_overview && dashboard.email_import_overview.total > 0 ? (
              <>
                <Text>Total traité: {dashboard.email_import_overview.total}</Text>
                <Text>Importés avec succès: {dashboard.email_import_overview.succeeded}</Text>
                {Object.entries(dashboard.email_import_overview.by_outcome)
                  .filter(([name]) => name !== 'email_import_succeeded')
                  .map(([name, count]) => (
                    <Text key={name}>• {name}: {count}</Text>
                  ))}
              </>
            ) : (
              <EmptyState label="Aucun email traité sur cette période." />
            )}
          </AdminSectionCard>

          <AdminSectionCard title="Coûts & revenu">
            <Text>Coût OCR: {formatMoney(dashboard.cost_metrics?.ocr_cost_eur ?? 0)}</Text>
            <Text>Coût par utilisateur actif: {formatMoney(dashboard.cost_metrics?.cost_per_active_user_eur ?? 0)}</Text>
            <Text>Revenu net estimé: {formatMoney(dashboard.cost_metrics?.estimated_net_revenue_eur ?? 0)}</Text>
          </AdminSectionCard>

          <AdminSectionCard title="Crashs frontend">
            <Text>Total sur la période: {dashboard.crash_reports?.total ?? 0}</Text>
            {(dashboard.crash_reports?.recent || []).slice(0, 5).map((crash, idx) => (
              <Text key={idx} numberOfLines={2}>• [{crash.screen || '?'}] {crash.message || 'sans message'}</Text>
            ))}
            {(!dashboard.crash_reports || dashboard.crash_reports.total === 0) && <EmptyState label="Aucun crash remonté." />}
          </AdminSectionCard>

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

          <AdminSectionCard title="Services externes & limites">
            {(dashboard.external_service_quotas?.services || []).map((service) => {
              const used = service.usage_current_period;
              const limit = service.quota_limit_value;
              const percent = service.usage_percent;
              const ratio = percent != null ? Math.max(0, Math.min(percent / 100, 1)) : 0;
              const status = quotaStatusLabel(service.status);
              const color = quotaStatusColor(service.status);
              return (
                <View key={service.service_key} style={styles.quotaCard}>
                  <View style={styles.quotaHeader}>
                    <Text style={styles.quotaTitle}>{service.display_name}</Text>
                    <Text style={[styles.quotaStatus, { color }]}>{status}</Text>
                  </View>
                  <Text style={styles.quotaMeta}>Usage: {used ?? 'unknown'} / {limit ?? 'unknown'} {service.quota_unit || ''}</Text>
                  <Text style={styles.quotaMeta}>Période quota: {quotaPeriodLabel(service.quota_period)}</Text>
                  <Text style={styles.quotaMeta}>Restant: {service.usage_remaining ?? 'unknown'}</Text>
                  <Text style={styles.quotaMeta}>Consommation: {percent != null ? `${percent}%` : 'unknown'}</Text>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${ratio * 100}%`, backgroundColor: color }]} />
                  </View>
                  <Text style={styles.quotaMeta}>Pricing: {service.pricing_note || 'pricing unknown'}</Text>
                  <Text style={styles.quotaMeta}>Upgrade: {service.upgrade_note || 'à renseigner'}</Text>
                  <Text style={styles.quotaMeta}>Source quota: {service.source_of_truth || 'unknown'}</Text>
                  <Text style={styles.quotaMeta}>Fenêtre observée: {service.usage_window || 'unknown'}</Text>
                </View>
              );
            })}
            {(!dashboard.external_service_quotas?.services || dashboard.external_service_quotas.services.length === 0) && (
              <EmptyState label="Quota indisponible / non configuré / unknown." />
            )}
          </AdminSectionCard>
        </>
      )}
    </AdminScaffold>
  );
}


const styles = StyleSheet.create({
  quotaCard: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 10, marginBottom: 8, gap: 4 },
  quotaHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  quotaTitle: { fontWeight: '700', fontSize: 14 },
  quotaStatus: { fontWeight: '700', textTransform: 'uppercase' },
  quotaMeta: { fontSize: 12, color: '#374151' },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: '#E5E7EB', overflow: 'hidden', marginTop: 2, marginBottom: 4 },
  progressFill: { height: '100%', borderRadius: 999 },
});
