/**
 * Configuration centralisée pour les flags de debug.
 * Modifier DEBUG_SWIPE_ACTIONS pour activer/désactiver les logs de swipe.
 *
 * À compiler hors du bundle, donc zéro impact performance quand désactivé.
 */

// 🔴 MODIFIER CETTE VALEUR POUR ACTIVER/DÉSACTIVER LES LOGS
export const DEBUG_SWIPE_ACTIONS = false; // ← Change to true to enable

// Taille du buffer circulaire (nombre de logs à conserver en mémoire)
export const DEBUG_LOG_BUFFER_SIZE = 500;

// Afficher les logs dans la console aussi
export const DEBUG_LOG_TO_CONSOLE = true;
