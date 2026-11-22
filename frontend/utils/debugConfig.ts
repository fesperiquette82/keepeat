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

// BUG-077 : Expo n'inline dans le bundle que les accès STATIQUES à
// `process.env.EXPO_PUBLIC_*`. Un accès dynamique (`process.env[name]`) vaut
// toujours `undefined` dans un build publié : les flags ne pouvaient donc jamais
// être activés sur un build de test, contrairement à ce que promet l'en-tête.
function envFlag(raw: string | undefined): boolean {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
}

/** Vrai en développement local, faux dans un build de production. */
const isDevelopment = typeof __DEV__ !== 'undefined' && __DEV__ === true;

export const DEBUG_SWIPE_ACTIONS =
  envFlag(process.env.EXPO_PUBLIC_DEBUG_SWIPE_ACTIONS) || isDevelopment;

// Taille du buffer circulaire (nombre de logs à conserver en mémoire)
export const DEBUG_LOG_BUFFER_SIZE = 500;

// Recopier les logs dans la console — bruyant et inutile en production.
export const DEBUG_LOG_TO_CONSOLE =
  envFlag(process.env.EXPO_PUBLIC_DEBUG_LOG_TO_CONSOLE) || isDevelopment;
