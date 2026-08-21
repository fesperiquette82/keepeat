import React, { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert, Share, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useHouseholdStore } from '../store/householdStore';
import { useAuthStore } from '../store/authStore';

export default function HouseholdScreen() {
  const router = useRouter();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const { household, isLoading, error, refresh, create, invite, join, leave } = useHouseholdStore();
  const [name, setName] = useState('');
  const [joinToken, setJoinToken] = useState('');
  const [isInviting, setIsInviting] = useState(false);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isOwner = !!household && household.owner_id === currentUserId;

  const handleCreate = async () => {
    if (!name.trim()) return;
    const ok = await create(name.trim());
    if (!ok) Alert.alert('Erreur', "Impossible de créer le foyer. Réessayez.");
  };

  const handleInvite = async () => {
    setIsInviting(true);
    try {
      const result = await invite();
      if (!result) {
        Alert.alert('Erreur', "Impossible de générer une invitation.");
        return;
      }
      await Share.share({
        message: `Rejoins mon foyer sur KeepEat : keepeat://join?token=${result.token}`,
      });
    } finally {
      setIsInviting(false);
    }
  };

  const handleJoin = async () => {
    if (!joinToken.trim()) return;
    const ok = await join(joinToken.trim());
    if (!ok) Alert.alert('Erreur', "Invitation invalide ou expirée.");
  };

  const handleLeave = () => {
    Alert.alert(
      isOwner ? 'Quitter le foyer' : 'Quitter le foyer',
      isOwner
        ? "En tant que propriétaire, vous ne pouvez quitter que si vous êtes le seul membre."
        : 'Vous perdrez l\'accès au stock et à l\'abonnement partagés du foyer.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Quitter',
          style: 'destructive',
          onPress: async () => {
            const ok = await leave();
            if (!ok) Alert.alert('Erreur', "Impossible de quitter le foyer.");
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Foyer</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {isLoading && !household ? (
          <ActivityIndicator style={styles.loader} color="#16A34A" />
        ) : household ? (
          <View style={styles.card}>
            <Text style={styles.householdName}>{household.name}</Text>
            <Text style={styles.subtitle}>{household.members.length} membre(s)</Text>
            {household.members.map((member) => (
              <View key={member.user_id} style={styles.memberRow}>
                <Text style={styles.memberEmail}>{member.email || member.user_id}</Text>
                <Text style={styles.memberRole}>{member.role === 'owner' ? 'Propriétaire' : 'Membre'}</Text>
              </View>
            ))}

            {isOwner && (
              <TouchableOpacity style={styles.primaryButton} onPress={handleInvite} disabled={isInviting}>
                {isInviting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryLabel}>Inviter un membre</Text>}
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.dangerButton} onPress={handleLeave}>
              <Text style={styles.dangerLabel}>Quitter le foyer</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.subtitle}>Partagez votre stock et votre abonnement premium avec votre foyer.</Text>

            <Text style={styles.label}>Créer un foyer</Text>
            <TextInput
              style={styles.input}
              placeholder="Nom du foyer"
              value={name}
              onChangeText={setName}
              testID="household-name-input"
            />
            <TouchableOpacity style={styles.primaryButton} onPress={handleCreate} disabled={isLoading}>
              <Text style={styles.primaryLabel}>Créer</Text>
            </TouchableOpacity>

            <Text style={[styles.label, styles.labelSpaced]}>Rejoindre un foyer existant</Text>
            <TextInput
              style={styles.input}
              placeholder="Code d'invitation"
              value={joinToken}
              onChangeText={setJoinToken}
              testID="household-join-input"
            />
            <TouchableOpacity style={styles.secondaryButton} onPress={handleJoin} disabled={isLoading}>
              <Text style={styles.secondaryLabel}>Rejoindre</Text>
            </TouchableOpacity>
          </View>
        )}

        {!!error && <Text style={styles.errorText}>{error}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F8FA', padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  scrollContent: { paddingBottom: 40 },
  backText: { color: '#16A34A', fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '800', color: '#111827' },
  loader: { marginTop: 24 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 12 },
  householdName: { fontSize: 20, fontWeight: '800', color: '#111827' },
  subtitle: { fontSize: 14, color: '#4B5563' },
  label: { fontSize: 14, fontWeight: '700', color: '#111827' },
  labelSpaced: { marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 12, fontSize: 15 },
  memberRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  memberEmail: { fontSize: 14, color: '#1F2937' },
  memberRole: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  primaryButton: { backgroundColor: '#16A34A', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryLabel: { color: '#fff', fontWeight: '700' },
  secondaryButton: { borderRadius: 10, borderWidth: 1, borderColor: '#16A34A', paddingVertical: 12, alignItems: 'center' },
  secondaryLabel: { color: '#166534', fontWeight: '700' },
  dangerButton: { alignItems: 'center', paddingVertical: 10 },
  dangerLabel: { color: '#DC2626', fontWeight: '600' },
  errorText: { color: '#DC2626', marginTop: 12, textAlign: 'center' },
});
