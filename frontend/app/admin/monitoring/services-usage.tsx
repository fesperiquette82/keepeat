import React, { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { AdminMonitoringNav } from '../../../component/admin/AdminMonitoringNav';
import { AdminScaffold, AdminSectionCard, EmptyState, ErrorState, formatMoney, KpiCard, LoadingState } from '../../../component/admin/AdminUi';
import { buildPeriodParams, getMonitoringServicesUsage, MonitoringServicesUsageResponse } from '../../../utils/adminMonitoringApi';
import { useAuthStore } from '../../../store/authStore';

const PERIODS: ('7d' | '30d')[] = ['7d', '30d'];

export default function AdminMonitoringServicesUsageScreen() {
  const [period, setPeriod] = useState<'7d' | '30d'>('30d');
  const [data, setData] = useState<MonitoringServicesUsageResponse | null>(null);
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
        const response = await getMonitoringServicesUsage(token, params, controller.signal);
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

  const totalCalls = useMemo(() => (data?.services || []).reduce((sum, svc) => sum + (svc.calls || 0), 0), [data]);

  return (
    <AdminScaffold title="Admin Monitoring — Services usage">
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
            <KpiCard label="Services trackés" value={data.services.length} />
            <KpiCard label="Total calls" value={totalCalls} />
            <KpiCard label="Coût estimé" value={formatMoney(data.total_estimated_cost)} hint="Valeur estimative" />
          </View>

          {(data.services || []).map((service) => (
            <AdminSectionCard key={service.service_name} title={service.service_name}>
              <Text>Units: {service.units}</Text>
              <Text>Calls: {service.calls}</Text>
              <Text>Estimated cost: {formatMoney(service.estimated_cost)}</Text>
              {(service.actions || []).slice(0, 8).map((action) => (
                <Text key={`${service.service_name}-${action.action_name}-${action.plan_type}`}>
                  • {action.action_name} [{action.plan_type}] — units {action.units} | calls {action.calls} | {formatMoney(action.estimated_cost)}
                </Text>
              ))}
            </AdminSectionCard>
          ))}
          {data.services.length === 0 && <EmptyState label="Aucun usage de service sur cette période." />}
        </>
      )}
    </AdminScaffold>
  );
}
