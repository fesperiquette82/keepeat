import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { C } from '../../utils/theme';

const LINKS = [
  { label: 'Dashboard', path: '/admin/monitoring' },
  { label: 'APIs', path: '/admin/monitoring/apis' },
  { label: 'Users', path: '/admin/monitoring/users' },
  { label: 'Subscriptions', path: '/admin/monitoring/subscriptions' },
  { label: 'Services', path: '/admin/monitoring/services-usage' },
  { label: 'Trends', path: '/admin/monitoring/trends' },
  { label: 'Events', path: '/admin/monitoring/events' },
  { label: 'Tickets', path: '/admin/monitoring/receipt-tickets' },
];

export function AdminMonitoringNav() {
  const pathname = usePathname();
  return (
    <View style={styles.row}>
      {LINKS.map((link) => {
        const active = pathname === link.path;
        return (
          <TouchableOpacity
            key={link.path}
            onPress={() => router.push(link.path as never)}
            style={[styles.pill, active && styles.pillActive]}
          >
            <Text style={[styles.pillText, active && styles.pillTextActive]}>{link.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  pillActive: { borderColor: C.primary, backgroundColor: C.primaryLight },
  pillText: { color: C.textMid, fontSize: 12, fontWeight: '700' },
  pillTextActive: { color: '#166534' },
});
