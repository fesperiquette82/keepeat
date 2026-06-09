import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AdminMonitoringNav } from '../../../component/admin/AdminMonitoringNav';
import { AdminScaffold, AdminSectionCard, EmptyState, ErrorState, formatDate, formatMoney, formatMs, KpiCard, LoadingState, StatusBadge } from '../../../component/admin/AdminUi';
import { getMonitoringCosts, getMonitoringServiceStatus, getMonitoringUsage, MonitoringCostsResponse, MonitoringServiceStatusResponse, MonitoringUsageResponse } from '../../../utils/adminMonitoringApi';
import { useAuthStore } from '../../../store/authStore';
import { C } from '../../../utils/theme';

function ProgressBar({ ratio, tone }: { ratio: number; tone: 'normal' | 'warning' | 'critical' }) {
  const width = `${Math.max(0, Math.min(ratio, 1)) * 100}%` as `${number}%`;
  const color = tone === 'critical' ? '#DC2626' : tone === 'warning' ? '#D97706' : '#16A34A';
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width, backgroundColor: color }]} />
    </View>
  );
}

export default function AdminMonitoringServicesUsageScreen() {
  const [servicesData, setServicesData] = useState<MonitoringServiceStatusResponse | null>(null);
  const [usageData, setUsageData] = useState<MonitoringUsageResponse | null>(null);
  const [costsData, setCostsData] = useState<MonitoringCostsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partialErrors, setPartialErrors] = useState<string[]>([]);
  const token = useAuthStore((state) => state.token);

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        setPartialErrors([]);
        if (!token) throw new Error('Session expirée');
        const [servicesResult, usageResult, costsResult] = await Promise.allSettled([
          getMonitoringServiceStatus(token, controller.signal),
          getMonitoringUsage(token, controller.signal),
          getMonitoringCosts(token, controller.signal),
        ]);
        const nextPartialErrors: string[] = [];

        if (servicesResult.status === 'fulfilled') setServicesData(servicesResult.value);
        else {
          setServicesData(null);
          nextPartialErrors.push('Services indisponibles');
        }

        if (usageResult.status === 'fulfilled') setUsageData(usageResult.value);
        else {
          setUsageData(null);
          nextPartialErrors.push('Usage indisponible');
        }

        if (costsResult.status === 'fulfilled') setCostsData(costsResult.value);
        else {
          setCostsData(null);
          nextPartialErrors.push('Coûts indisponibles');
        }

        if (nextPartialErrors.length === 3) {
          throw new Error('Chargement impossible');
        }
        setPartialErrors(nextPartialErrors);
      } catch (e: any) {
        setError(e?.message || 'Chargement impossible');
      } finally {
        setLoading(false);
      }
    };
    run();
    return () => controller.abort();
  }, [token]);

  const connectedServices = useMemo(
    () => (servicesData?.services || []).filter((svc) => svc.status === 'connected').length,
    [servicesData],
  );
  const serviceLabelById = useMemo(() => {
    const fallback: Record<string, string> = {
      keepeat_backend_api: 'Backend API KeepEat',
      mongodb: 'MongoDB',
      openfoodfacts_api: 'Open Food Facts API',
      ocr_engine: 'OCR engine',
      frontend_backend_connectivity: 'Frontend → Backend connectivity',
    };
    const map: Record<string, string> = { ...fallback };
    (servicesData?.services || []).forEach((service) => {
      map[service.id] = service.name || map[service.id] || service.id;
    });
    return map;
  }, [servicesData]);

  return (
    <AdminScaffold title="Admin — Service Control Center">
      <AdminMonitoringNav />
      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} />}
      {!loading && !error && (
        <>
          {partialErrors.length > 0 && (
            <AdminSectionCard title="Données partielles">
              <Text style={styles.itemMessage}>
                Certaines sections ne sont pas disponibles: {partialErrors.join(', ')}.
              </Text>
            </AdminSectionCard>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <KpiCard label="Services" value={servicesData?.services?.length || 0} />
            <KpiCard label="Connectés" value={connectedServices} />
            <KpiCard label="Usage tracké" value={usageData?.usage?.length || 0} />
            <KpiCard label="Coût estimé" value={formatMoney((costsData?.costs || []).reduce((sum, row) => sum + Number(row.estimated_monthly_cost || 0), 0))} />
          </View>

          <AdminSectionCard title="Services">
            {(servicesData?.services || []).map((service) => (
              <View key={service.id} style={styles.itemCard}>
                <View style={styles.itemHeader}>
                  <Text style={styles.itemTitle}>{service.name}</Text>
                  <StatusBadge status={service.status} />
                </View>
                <Text style={styles.itemMeta}>Type: {service.type} • Catégorie: {service.category || '—'}</Text>
                <Text style={styles.itemMeta}>Latence: {service.latency_ms != null ? formatMs(service.latency_ms) : '—'}</Text>
                <Text style={styles.itemMeta}>Dernier check: {formatDate(service.last_checked_at)}</Text>
                <Text style={styles.itemMessage}>{service.message || '—'}</Text>
              </View>
            ))}
            {!servicesData && <EmptyState label="Section Services indisponible." />}
            {servicesData && (servicesData?.services || []).length === 0 && <EmptyState label="Aucun service détecté." />}
          </AdminSectionCard>

          <AdminSectionCard title="Usage">
            {(usageData?.usage || []).map((item) => {
              const usagePercent = item.usage_percent ?? null;
              const tone: 'normal' | 'warning' | 'critical' =
                item.warning_level === 'warning' || item.warning_level === 'critical' ? item.warning_level : 'normal';
              return (
                <View key={`${item.service_id}-${item.label}`} style={styles.itemCard}>
                  <Text style={styles.itemTitle}>{item.label}</Text>
                  <Text style={styles.itemMeta}>Actuel: {item.current_usage}</Text>
                  <Text style={styles.itemMeta}>Quota free: {item.free_quota ?? 'N/A'}</Text>
                  {usagePercent != null && <ProgressBar ratio={usagePercent} tone={tone} />}
                  <Text style={styles.itemMeta}>Alerte: {item.warning_level}</Text>
                  <Text style={styles.itemMeta}>Projection fin de mois: {item.projected_month_end_usage ?? '—'} ({item.confidence || 'low'})</Text>
                  {!!item.note && <Text style={styles.itemMessage}>{item.note}</Text>}
                </View>
              );
            })}
            {!usageData && <EmptyState label="Section Usage indisponible." />}
            {usageData && (usageData?.usage || []).length === 0 && <EmptyState label="Aucune métrique d'usage disponible." />}
          </AdminSectionCard>

          <AdminSectionCard title="Coûts">
            {(costsData?.costs || []).map((cost) => (
              <View key={cost.service_id} style={styles.itemCard}>
                <Text style={styles.itemTitle}>{serviceLabelById[cost.service_id] || cost.service_id}</Text>
                <Text style={styles.itemMessage}>ID: {cost.service_id}</Text>
                <Text style={styles.itemMeta}>Plan actuel: {cost.current_plan}</Text>
                <Text style={styles.itemMeta}>Usage mensuel estimé: {cost.estimated_monthly_usage}</Text>
                <Text style={styles.itemMeta}>Coût mensuel estimé: {formatMoney(cost.estimated_monthly_cost)}</Text>
                <Text style={styles.itemMeta}>Palier recommandé: {cost.recommended_next_plan}</Text>
                <Text style={styles.itemMeta}>Confiance: {cost.confidence} {cost.is_estimated ? '(estimé)' : '(mesuré)'}</Text>
                <Text style={styles.itemMessage}>{cost.recommendation_reason}</Text>
              </View>
            ))}
            {!!costsData?.pricing_note && <Text style={styles.itemMessage}>{costsData.pricing_note}</Text>}
            {!costsData && <EmptyState label="Section Coûts indisponible." />}
            {costsData && (costsData?.costs || []).length === 0 && <EmptyState label="Aucune recommandation de coût." />}
          </AdminSectionCard>
        </>
      )}
    </AdminScaffold>
  );
}

const styles = StyleSheet.create({
  itemCard: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 10,
    gap: 4,
    backgroundColor: '#fff',
  },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center' },
  itemTitle: { fontWeight: '700', color: C.text, fontSize: 15 },
  itemMeta: { color: C.textMid, fontSize: 13 },
  itemMessage: { color: C.textLight, fontSize: 12 },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: '#E5E7EB', overflow: 'hidden', marginTop: 4, marginBottom: 4 },
  progressFill: { height: '100%', borderRadius: 999 },
});
