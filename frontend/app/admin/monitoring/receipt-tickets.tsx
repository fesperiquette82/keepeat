import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AdminMonitoringNav } from '../../../component/admin/AdminMonitoringNav';
import { AdminScaffold, EmptyState, ErrorState, LoadingState } from '../../../component/admin/AdminUi';
import { useAuthStore } from '../../../store/authStore';
import { buildApiUrl } from '../../../utils/config';
import { C, shadowSm } from '../../../utils/theme';
import axios from 'axios';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Ticket {
  id: string;
  user_id: string;
  user_email: string;
  created_at: string;
  status: 'pending' | 'processed' | 'dismissed';
  note: string;
  items_added: { name: string; category: string }[];
}

interface TicketDetail extends Ticket {
  image_b64: string;
}

interface DraftItem {
  name: string;
  category: string;
  expiry_date: string;
}

const CATEGORIES = ['frais', 'proteines', 'legumes', 'feculents', 'desserts', 'boissons', 'epicerie', 'autres'];

const STATUS_LABELS: Record<string, string> = {
  pending: 'En attente',
  processed: 'Traité',
  dismissed: 'Ignoré',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#F59E0B',
  processed: '#16A34A',
  dismissed: '#9CA3AF',
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AdminReceiptTicketsScreen() {
  const token = useAuthStore((state) => state.token);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('pending');

  // Detail modal
  const [selectedTicket, setSelectedTicket] = useState<TicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [adminNote, setAdminNote] = useState('');
  const [processing, setProcessing] = useState(false);

  const authHeaders = useCallback(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const loadTickets = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(buildApiUrl('/api/admin/receipt-tickets'), {
        headers: authHeaders(),
        params: { status: filterStatus, limit: 50, skip: 0 },
      });
      setTickets(res.data.tickets);
      setTotal(res.data.total);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }, [token, filterStatus, authHeaders]);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  const openDetail = async (ticket: Ticket) => {
    setDetailLoading(true);
    setSelectedTicket(null);
    setDraftItems([{ name: '', category: 'autres', expiry_date: '' }]);
    setAdminNote('');
    try {
      const res = await axios.get(buildApiUrl(`/api/admin/receipt-tickets/${ticket.id}`), {
        headers: authHeaders(),
      });
      setSelectedTicket(res.data);
    } catch (e: any) {
      Alert.alert('Erreur', e?.response?.data?.detail || 'Impossible de charger le ticket');
    } finally {
      setDetailLoading(false);
    }
  };

  const addDraftItem = () => {
    setDraftItems(prev => [...prev, { name: '', category: 'autres', expiry_date: '' }]);
  };

  const removeDraftItem = (idx: number) => {
    setDraftItems(prev => prev.filter((_, i) => i !== idx));
  };

  const updateDraftItem = (idx: number, field: keyof DraftItem, value: string) => {
    setDraftItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const handleProcess = async () => {
    if (!selectedTicket) return;
    const validItems = draftItems.filter(i => i.name.trim());
    if (validItems.length === 0) {
      Alert.alert('Erreur', 'Ajoutez au moins un produit.');
      return;
    }
    setProcessing(true);
    try {
      await axios.post(
        buildApiUrl(`/api/admin/receipt-tickets/${selectedTicket.id}/process`),
        {
          items: validItems.map(i => ({
            name: i.name.trim(),
            category: i.category,
            expiry_date: i.expiry_date.trim() || null,
          })),
          note: adminNote,
        },
        { headers: authHeaders() },
      );
      setSelectedTicket(null);
      loadTickets();
    } catch (e: any) {
      Alert.alert('Erreur', e?.response?.data?.detail || 'Impossible de traiter le ticket');
    } finally {
      setProcessing(false);
    }
  };

  const handleDismiss = async () => {
    if (!selectedTicket) return;
    Alert.alert(
      'Ignorer ce ticket ?',
      'Le ticket sera marqué comme ignoré.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Ignorer',
          style: 'destructive',
          onPress: async () => {
            try {
              await axios.post(
                buildApiUrl(`/api/admin/receipt-tickets/${selectedTicket.id}/dismiss`),
                {},
                { headers: authHeaders() },
              );
              setSelectedTicket(null);
              loadTickets();
            } catch (e: any) {
              Alert.alert('Erreur', e?.response?.data?.detail || 'Erreur');
            }
          },
        },
      ],
    );
  };

  return (
    <AdminScaffold title="Tickets Caisse">
      <AdminMonitoringNav />

      {/* Filter bar */}
      <View style={styles.filterRow}>
        {['pending', 'processed', 'dismissed', 'all'].map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.filterChip, filterStatus === s && styles.filterChipActive]}
            onPress={() => setFilterStatus(s)}
          >
            <Text style={[styles.filterChipText, filterStatus === s && styles.filterChipTextActive]}>
              {s === 'all' ? 'Tous' : STATUS_LABELS[s]}
            </Text>
          </TouchableOpacity>
        ))}
        <Text style={styles.totalLabel}>{total} ticket{total > 1 ? 's' : ''}</Text>
      </View>

      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} />}
      {!loading && !error && tickets.length === 0 && (
        <EmptyState label="Aucun ticket dans cette catégorie." />
      )}
      {!loading && !error && tickets.map(ticket => (
        <TouchableOpacity key={ticket.id} style={styles.ticketCard} onPress={() => openDetail(ticket)}>
          <View style={styles.ticketHeader}>
            <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[ticket.status] ?? '#ccc' }]} />
            <Text style={styles.ticketEmail}>{ticket.user_email || ticket.user_id}</Text>
            <Text style={styles.ticketStatus}>{STATUS_LABELS[ticket.status] ?? ticket.status}</Text>
          </View>
          <Text style={styles.ticketDate}>
            {new Date(ticket.created_at).toLocaleString('fr-FR')}
          </Text>
          {ticket.status === 'processed' && ticket.items_added.length > 0 && (
            <Text style={styles.ticketItems}>
              {ticket.items_added.length} produit{ticket.items_added.length > 1 ? 's' : ''} ajouté{ticket.items_added.length > 1 ? 's' : ''}
            </Text>
          )}
        </TouchableOpacity>
      ))}

      {/* Detail modal */}
      <Modal visible={!!selectedTicket || detailLoading} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          {detailLoading ? (
            <LoadingState label="Chargement du ticket..." />
          ) : selectedTicket ? (
            <ScrollView contentContainerStyle={styles.modalContent}>
              {/* Header */}
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Ticket — {selectedTicket.user_email}</Text>
                <TouchableOpacity onPress={() => setSelectedTicket(null)} style={styles.closeBtn}>
                  <Text style={styles.closeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Receipt image */}
              {selectedTicket.image_b64 ? (
                <Image
                  source={{ uri: `data:image/jpeg;base64,${selectedTicket.image_b64}` }}
                  style={styles.receiptImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.receiptImagePlaceholder}>
                  <Text style={{ color: C.textLight }}>Pas d'image</Text>
                </View>
              )}

              {/* Already processed */}
              {selectedTicket.status !== 'pending' && (
                <View style={styles.processedBanner}>
                  <Text style={styles.processedBannerText}>
                    Statut : {STATUS_LABELS[selectedTicket.status]}
                    {selectedTicket.note ? ` — ${selectedTicket.note}` : ''}
                  </Text>
                </View>
              )}

              {/* Items form (only for pending) */}
              {selectedTicket.status === 'pending' && (
                <>
                  <Text style={styles.sectionLabel}>Produits à ajouter au stock</Text>
                  {draftItems.map((item, idx) => (
                    <View key={idx} style={styles.draftItem}>
                      <View style={styles.draftItemRow}>
                        <TextInput
                          style={[styles.input, { flex: 1 }]}
                          value={item.name}
                          onChangeText={v => updateDraftItem(idx, 'name', v)}
                          placeholder="Nom du produit"
                          placeholderTextColor={C.textLight}
                        />
                        <TouchableOpacity style={styles.removeBtn} onPress={() => removeDraftItem(idx)}>
                          <Text style={styles.removeBtnText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={styles.draftItemRow}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          <View style={{ flexDirection: 'row', gap: 6 }}>
                            {CATEGORIES.map(cat => (
                              <TouchableOpacity
                                key={cat}
                                style={[styles.catChip, item.category === cat && styles.catChipActive]}
                                onPress={() => updateDraftItem(idx, 'category', cat)}
                              >
                                <Text style={[styles.catChipText, item.category === cat && styles.catChipTextActive]}>
                                  {cat}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </ScrollView>
                      </View>
                      <TextInput
                        style={styles.input}
                        value={item.expiry_date}
                        onChangeText={v => updateDraftItem(idx, 'expiry_date', v)}
                        placeholder="Date DLC (YYYY-MM-DD, optionnel)"
                        placeholderTextColor={C.textLight}
                      />
                    </View>
                  ))}

                  <TouchableOpacity style={styles.addItemBtn} onPress={addDraftItem}>
                    <Text style={styles.addItemBtnText}>+ Ajouter un produit</Text>
                  </TouchableOpacity>

                  <TextInput
                    style={[styles.input, { marginTop: 12 }]}
                    value={adminNote}
                    onChangeText={setAdminNote}
                    placeholder="Note admin (optionnel)"
                    placeholderTextColor={C.textLight}
                  />

                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.processBtn, processing && { opacity: 0.6 }]}
                      onPress={handleProcess}
                      disabled={processing}
                    >
                      {processing ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.processBtnText}>Valider et ajouter au stock</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.dismissBtn} onPress={handleDismiss} disabled={processing}>
                      <Text style={styles.dismissBtnText}>Ignorer</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </ScrollView>
          ) : null}
        </View>
      </Modal>
    </AdminScaffold>
  );
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 },
  filterChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: '#fff',
  },
  filterChipActive: { borderColor: C.primary, backgroundColor: C.primaryLight },
  filterChipText: { fontSize: 12, fontWeight: '700', color: C.textMid },
  filterChipTextActive: { color: '#166534' },
  totalLabel: { fontSize: 12, color: C.textLight, marginLeft: 'auto' },

  ticketCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, gap: 4, ...shadowSm,
  },
  ticketHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  ticketEmail: { flex: 1, fontSize: 14, fontWeight: '700', color: C.text },
  ticketStatus: { fontSize: 12, color: C.textMid, fontWeight: '600' },
  ticketDate: { fontSize: 12, color: C.textLight },
  ticketItems: { fontSize: 12, color: '#16A34A', fontWeight: '600' },

  // Modal
  modalContainer: { flex: 1, backgroundColor: C.bg },
  modalContent: { padding: 16, gap: 12 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: C.text, flex: 1 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { fontSize: 14, fontWeight: '700', color: C.textMid },

  receiptImage: { width: '100%', height: 300, borderRadius: 12, backgroundColor: '#F3F4F6' },
  receiptImagePlaceholder: {
    width: '100%', height: 120, borderRadius: 12, backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
  },

  processedBanner: {
    backgroundColor: '#F0FDF4', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#BBF7D0',
  },
  processedBannerText: { fontSize: 13, color: '#166534', fontWeight: '600' },

  sectionLabel: { fontSize: 14, fontWeight: '700', color: C.text },

  draftItem: {
    backgroundColor: '#fff', borderRadius: 12, padding: 12, gap: 8,
    borderWidth: 1, borderColor: C.border,
  },
  draftItemRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    backgroundColor: '#F3F4F6', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: C.text, borderWidth: 1, borderColor: C.border,
  },
  removeBtn: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: '#FEE2E2',
    alignItems: 'center', justifyContent: 'center',
  },
  removeBtnText: { color: '#EF4444', fontWeight: '700' },

  catChip: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 16,
    borderWidth: 1, borderColor: C.border, backgroundColor: '#F9FAFB',
  },
  catChipActive: { borderColor: C.primary, backgroundColor: C.primaryLight },
  catChipText: { fontSize: 11, fontWeight: '600', color: C.textMid },
  catChipTextActive: { color: '#166534' },

  addItemBtn: {
    borderWidth: 1.5, borderColor: C.primary, borderRadius: 10,
    paddingVertical: 10, alignItems: 'center', borderStyle: 'dashed',
  },
  addItemBtnText: { color: C.primary, fontWeight: '700', fontSize: 14 },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  processBtn: {
    flex: 1, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  processBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  dismissBtn: {
    paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12,
    backgroundColor: '#FEE2E2', alignItems: 'center',
  },
  dismissBtnText: { color: '#EF4444', fontWeight: '700', fontSize: 14 },
});
