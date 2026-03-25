import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

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
  const scale   = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    // Petit délai avant le départ → l'écran a le temps de se rendre,
    // ce qui évite un flash et donne un effet plus soigné.
    const timer = setTimeout(() => {
      Animated.parallel([

        // ── Fade-in : 400ms, linéaire ──────────────────────────────────
        Animated.timing(opacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true, // exécuté sur le thread UI natif → 60 fps garanti
        }),

        // ── Scale avec spring : léger "rebond" naturel ─────────────────
        // tension : rigidité du ressort (plus élevé = plus rapide)
        // friction : amortissement (plus bas = plus de rebond)
        Animated.spring(scale, {
          toValue: 1,
          tension: 60,   // réactif sans être brutal
          friction: 8,   // légèrement sous-amorti → petit bounce à la fin
          useNativeDriver: true,
        }),

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
