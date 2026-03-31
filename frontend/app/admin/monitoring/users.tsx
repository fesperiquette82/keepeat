import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AdminMonitoringNav } from '../../../component/admin/AdminMonitoringNav';
import { AdminScaffold, ErrorState, KpiCard, LoadingState } from '../../../component/admin/AdminUi';
import { getMonitoringUsers, MonitoringUsersResponse } from '../../../utils/adminMonitoringApi';
import { useAuthStore } from '../../../store/authStore';

export default function AdminMonitoringUsersScreen() {
  const [data, setData] = useState<MonitoringUsersResponse | null>(null);
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
        setData(await getMonitoringUsers(token, controller.signal));
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
    <AdminScaffold title="Admin Monitoring — Users">
      <AdminMonitoringNav />
      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <KpiCard label="Total" value={data.total ?? 0} />
          <KpiCard label="New today" value={data.new_today ?? 0} />
          <KpiCard label="New 7d" value={data.new_7d ?? 0} />
          <KpiCard label="New 30d" value={data.new_30d ?? 0} />
          <KpiCard label="DAU / WAU / MAU" value={`${data.dau ?? 0} / ${data.wau ?? 0} / ${data.mau ?? 0}`} />
          <KpiCard label="Free / Premium" value={`${data.free ?? 0} / ${data.premium ?? 0}`} />
        </View>
      )}
    </AdminScaffold>
  );
}
