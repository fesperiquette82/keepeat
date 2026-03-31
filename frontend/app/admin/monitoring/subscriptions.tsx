import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { AdminMonitoringNav } from '../../../component/admin/AdminMonitoringNav';
import { AdminScaffold, AdminSectionCard, ErrorState, formatMoney, KpiCard, LoadingState } from '../../../component/admin/AdminUi';
import { getMonitoringSubscriptions, MonitoringSubscriptionsResponse } from '../../../utils/adminMonitoringApi';
import { useAuthStore } from '../../../store/authStore';

export default function AdminMonitoringSubscriptionsScreen() {
  const [data, setData] = useState<MonitoringSubscriptionsResponse | null>(null);
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
        setData(await getMonitoringSubscriptions(token, controller.signal));
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
    <AdminScaffold title="Admin Monitoring — Subscriptions">
      <AdminMonitoringNav />
      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <KpiCard label="Actives" value={data.active_subscriptions} />
            <KpiCard label="Inactives / expirées" value={data.inactive_or_expired ?? 0} />
            <KpiCard label="MRR estimé" value={formatMoney(data.estimated_mrr_eur ?? 0)} hint="Valeur estimée" />
            <KpiCard label="ARR estimé" value={formatMoney(data.estimated_arr_eur ?? 0)} hint="Valeur estimée" />
          </View>
          <AdminSectionCard title="Répartition par plan">
            {Object.entries(data.subscriptions_by_plan || {}).map(([plan, count]) => (
              <Text key={plan}>• {plan}: {count}</Text>
            ))}
          </AdminSectionCard>
        </>
      )}
    </AdminScaffold>
  );
}
