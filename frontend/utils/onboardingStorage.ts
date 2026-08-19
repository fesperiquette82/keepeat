import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_SEEN_KEY_PREFIX = 'keepeat_onboarding_seen_';

/**
 * BUG-043 (audit commercial, point 10) : aucun nouvel utilisateur n'était
 * jamais dirigé vers un parcours d'accueil — il atterrissait directement sur
 * le tableau de bord, qui n'a rien à montrer tant que le stock est vide.
 * Le flag est local (par utilisateur, pas remonté au backend) : un onboarding
 * raté à cause d'une erreur de lecture ne doit jamais bloquer l'accès à l'app.
 */
export async function hasSeenOnboarding(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_SEEN_KEY_PREFIX + userId)) === '1';
  } catch {
    return true;
  }
}

export async function markOnboardingSeen(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_SEEN_KEY_PREFIX + userId, '1');
  } catch {
    // best-effort — pas grave si l'onboarding réapparaît une fois de plus
  }
}
