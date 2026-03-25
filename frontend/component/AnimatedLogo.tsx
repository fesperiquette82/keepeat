import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

interface Props {
  children: React.ReactNode;
  /** Délai avant le départ de l'animation (ms). Défaut : 100ms pour un effet naturel. */
  delay?: number;
}

/**
 * Wrapper réutilisable : fade-in + scale spring au montage.
 * Fonctionne sur n'importe quel écran (login, splash, onboarding…).
 *
 * Usage :
 *   <AnimatedLogo>
 *     <View style={styles.logoSection}>…</View>
 *   </AnimatedLogo>
 */
export default function AnimatedLogo({ children, delay = 100 }: Props) {
  // Valeurs initiales : invisible (opacity 0) et légèrement réduit (scale 0.8)
  const opacity = useRef(new Animated.Value(0)).current;
  const scale   = useRef(new Animated.Value(0.75)).current;

  useEffect(() => {
    // Petit délai avant le départ → l'écran a le temps de se rendre,
    // ce qui évite un flash et donne un effet plus soigné.
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 320,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 1.05,
            duration: 260,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: 180,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    }, delay);

    // Nettoyage si le composant est démonté avant la fin du timer
    return () => clearTimeout(timer);
  }, []); // [] → une seule fois au montage

  return (
    <Animated.View style={{ opacity, transform: [{ scale }] }}>
      {children}
    </Animated.View>
  );
}
