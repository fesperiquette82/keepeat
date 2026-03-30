import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';

const ANIMATION_DURATION_MS = 600;

interface PremiumAnimatedLogoProps {
  onAnimationEnd?: () => void;
}

/**
 * Logo premium d'ouverture : fade-in + scale 0.75 -> 1.05 -> 1.
 * Conçu pour être réutilisé (splash overlay, onboarding, etc.).
 */
export default function PremiumAnimatedLogo({ onAnimationEnd }: PremiumAnimatedLogoProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.75)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: ANIMATION_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.05,
          duration: 380,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          damping: 12,
          stiffness: 180,
          mass: 0.85,
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => onAnimationEnd?.());
  }, [onAnimationEnd, opacity, scale]);

  return (
    <Animated.View style={[styles.wrapper, { opacity, transform: [{ scale }] }]}>
      <View style={styles.logoContainer}>
        <Image
          source={require('../assets/images/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 180,
    height: 180,
  },
});
