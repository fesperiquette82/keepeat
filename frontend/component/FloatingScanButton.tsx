import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type FloatingScanButtonProps = {
  onPress: () => void;
};

export default function FloatingScanButton({ onPress }: FloatingScanButtonProps) {
  const insets = useSafeAreaInsets();
  const bottomOffset = insets.bottom + 76;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Scan"
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          {
            bottom: bottomOffset,
          },
          pressed && styles.buttonPressed,
        ]}
      >
        <Ionicons name="scan" size={18} color="#FFFFFF" />
        <Text style={styles.label}>Scan</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: 16,
    minHeight: 52,
    borderRadius: 999,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0F8A43',
    shadowColor: '#0A4D2A',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  label: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
});
