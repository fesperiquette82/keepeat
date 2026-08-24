import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { AdminMonitoringNav } from '../../../component/admin/AdminMonitoringNav';
import { AdminScaffold, AdminSectionCard, EmptyState, ErrorState, formatMoney, LoadingState } from '../../../component/admin/AdminUi';
import { getMonitoringTrends, MonitoringTrendsResponse } from '../../../utils/adminMonitoringApi';
import { useAuthStore } from '../../../store/authStore';

const DAY_OPTIONS = [7, 30, 90] as const;

function TrendSeries({ title, rows, formatValue }: { title: string; rows: { date: string; value: number }[]; formatValue: (value: number) => string }) {
  const reversed = [...rows].reverse();
  return (
    <AdminSectionCard title={title}>
      {reversed.map((row) => (
        <Text key={row.date}>{row.date}: {formatValue(row.value)}</Text>
      ))}
      {reversed.length === 0 && <EmptyState label="Aucune donnée sur cette période." />}
    </AdminSectionCard>
  );
}

export default function AdminMonitoringTrendsScreen() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<MonitoringTrendsResponse | null>(null);
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
        const response = await getMonitoringTrends(token, { days }, controller.signal);
        setData(response);
      } catch (e: any) {
        setError(e?.message || 'Chargement impossible');
      } finally {
        setLoading(false);
      }
    };
    run();
    return () => controller.abort();
  }, [days, token]);

  return (
    <AdminScaffold title="Admin Monitoring — Trends">
      <AdminMonitoringNav />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {DAY_OPTIONS.map((d) => (
          <TouchableOpacity key={d} onPress={() => setDays(d)} style={{ backgroundColor: days === d ? '#DCFCE7' : '#fff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 }}>
            <Text>{d}j</Text>
          </TouchableOpacity>
        ))}
      </View>
      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <>
          <TrendSeries title="DAU (utilisateurs actifs par jour)" rows={data.dau.map((r) => ({ date: r.date, value: r.count }))} formatValue={(v) => String(v)} />
          <TrendSeries title="Nouveaux utilisateurs par jour" rows={data.new_users.map((r) => ({ date: r.date, value: r.count }))} formatValue={(v) => String(v)} />
          <TrendSeries title="Erreurs API par jour" rows={data.errors.map((r) => ({ date: r.date, value: r.count }))} formatValue={(v) => String(v)} />
          <TrendSeries title="Coûts services par jour" rows={data.costs.map((r) => ({ date: r.date, value: r.cost }))} formatValue={formatMoney} />
        </>
      )}
    </AdminScaffold>
  );
}
