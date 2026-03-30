import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';
import PremiumAnimatedLogo from './PremiumAnimatedLogo';

interface AnimatedSplashOverlayProps {
  /** Affiche/masque l'overlay (fallback utile en Expo Go). */
  visible: boolean;
  /** Notifie quand l'animation est terminée et que l'overlay peut disparaître. */
  onAnimationFinished: () => void;
}

export default function AnimatedSplashOverlay({ visible, onAnimationFinished }: AnimatedSplashOverlayProps) {
  const [hasAnimated, setHasAnimated] = useState(false);
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (!visible) {
      setHasAnimated(false);
    }
  }, [visible]);

  const backgroundColor = useMemo(() => {
    const dark = '#111827';
    const light = '#E3E8F0';
    return colorScheme === 'dark' ? dark : light;
  }, [colorScheme]);

  if (!visible) return null;

  return (
    <View pointerEvents="none" style={[styles.overlay, { backgroundColor }]}>
      <PremiumAnimatedLogo
        onAnimationEnd={() => {
          if (!hasAnimated) {
            setHasAnimated(true);
            onAnimationFinished();
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
