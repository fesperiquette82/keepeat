import React, { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { AdminMonitoringNav } from '../../../component/admin/AdminMonitoringNav';
import { AdminScaffold, AdminSectionCard, EmptyState, ErrorState, formatDate, LoadingState } from '../../../component/admin/AdminUi';
import { buildPeriodParams, getMonitoringEvents, MonitoringEventsResponse } from '../../../utils/adminMonitoringApi';
import { useAuthStore } from '../../../store/authStore';

export default function AdminMonitoringEventsScreen() {
  const [period, setPeriod] = useState<'24h' | '7d' | '30d'>('7d');
  const [eventName, setEventName] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MonitoringEventsResponse | null>(null);
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
        const response = await getMonitoringEvents(
          token,
          { ...params, page, page_size: 25, event_name: eventName || undefined, event_category: category || undefined },
          controller.signal,
        );
        setData(response);
      } catch (e: any) {
        setError(e?.message || 'Chargement impossible');
      } finally {
        setLoading(false);
      }
    };
    run();
    return () => controller.abort();
  }, [period, page, eventName, category, token]);

  return (
    <AdminScaffold title="Admin Monitoring — Events">
      <AdminMonitoringNav />

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {(['24h', '7d', '30d'] as const).map((p) => (
          <TouchableOpacity key={p} onPress={() => { setPeriod(p); setPage(1); }} style={{ backgroundColor: period === p ? '#DCFCE7' : '#fff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 }}>
            <Text>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput value={eventName} onChangeText={setEventName} placeholder="Filtre event_name" style={{ backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }} />
      <TextInput value={category} onChangeText={setCategory} placeholder="Filtre event_category" style={{ backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }} />

      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <>
          <Text>Total: {data.total}</Text>
          <AdminSectionCard title="Événements récents">
            {data.events.map((event) => (
              <View key={event.id} style={{ borderBottomWidth: 1, borderBottomColor: '#EEE', paddingBottom: 8, marginBottom: 8 }}>
                <Text>{event.event_name} ({event.event_category})</Text>
                <Text>{formatDate(event.created_at)}</Text>
                <Text numberOfLines={2}>metadata: {JSON.stringify(event.metadata_json || {})}</Text>
              </View>
            ))}
            {data.events.length === 0 && <EmptyState label="Aucun événement sur cette période." />}
          </AdminSectionCard>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <TouchableOpacity disabled={page <= 1} onPress={() => setPage((p) => Math.max(1, p - 1))}><Text>← Précédent</Text></TouchableOpacity>
            <Text>Page {data.page}</Text>
            <TouchableOpacity disabled={data.page * data.page_size >= data.total} onPress={() => setPage((p) => p + 1)}><Text>Suivant →</Text></TouchableOpacity>
          </View>
        </>
      )}
    </AdminScaffold>
  );
}
