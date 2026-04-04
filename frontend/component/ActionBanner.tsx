import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { C } from '../utils/theme';

type ActionBannerVariant = 'success' | 'error';

interface ActionBannerProps {
  message: string;
  actionLabel?: string;
  onActionPress?: () => void;
  onClose?: () => void;
  variant?: ActionBannerVariant;
  bottomOffset?: number;
}

export function ActionBanner({ message, actionLabel, onActionPress, onClose, variant = 'success', bottomOffset = 16 }: ActionBannerProps) {
  return (
    <View style={[styles.container, { bottom: bottomOffset }, variant === 'error' && styles.containerError]}>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.actions}>
        {actionLabel && onActionPress && (
          <TouchableOpacity onPress={onActionPress} style={styles.actionButton}>
            <Text style={styles.actionLabel}>{actionLabel}</Text>
          </TouchableOpacity>
        )}
        {onClose && (
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeLabel}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: '#14532D',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  containerError: {
    backgroundColor: C.red,
  },
  message: {
    flex: 1,
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  actionLabel: {
    color: '#fff',
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  closeButton: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  closeLabel: {
    color: '#fff',
    fontWeight: '700',
  },
});
