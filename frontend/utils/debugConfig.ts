/**
 * Configuration centralisée pour les flags de debug.
 *
 * BUG-067 : ces valeurs étaient codées à `true` en dur, donc actives dans les
 * builds distribués — les gestes de swipe étaient journalisés en continu (buffer
 * de 500 entrées) et recopiés dans la console. Elles sont désormais **désactivées
 * par défaut** et ne s'allument que par variable d'environnement au moment du
 * build, ou automatiquement en développement (`__DEV__`).
 *
 * Pour activer ponctuellement un diagnostic sur un build de test :
 *   EXPO_PUBLIC_DEBUG_SWIPE_ACTIONS=true eas build --profile preview …
 */

function envFlag(name: string): boolean {
  const raw = process.env[name];
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
}

/** Vrai en développement local, faux dans un build de production. */
const isDevelopment = typeof __DEV__ !== 'undefined' && __DEV__ === true;

export const DEBUG_SWIPE_ACTIONS =
  envFlag('EXPO_PUBLIC_DEBUG_SWIPE_ACTIONS') || isDevelopment;

// Taille du buffer circulaire (nombre de logs à conserver en mémoire)
export const DEBUG_LOG_BUFFER_SIZE = 500;

// Recopier les logs dans la console — bruyant et inutile en production.
export const DEBUG_LOG_TO_CONSOLE =
  envFlag('EXPO_PUBLIC_DEBUG_LOG_TO_CONSOLE') || isDevelopment;
