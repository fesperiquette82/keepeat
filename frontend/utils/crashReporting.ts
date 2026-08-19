import { fetchWithTimeout as fetch } from './fetchWithTimeout';
import { buildApiUrl } from './config';
import { logger } from './logger';

export interface CrashReportInfo {
  message: string;
  stack?: string;
  screen?: string;
  appVersion?: string;
  platform?: string;
}

/**
 * Alternative légère à @sentry/react-native (non ajouté : impossible de
 * valider un build natif iOS/Android dans cet environnement, et le risque
 * de casser le job CI de build APK ne se justifie pas pour ce correctif).
 * Remonte au backend les erreurs JS capturées par ErrorBoundary, en
 * best-effort (ne doit jamais faire échouer l'affichage de l'écran d'erreur).
 *
 * Ne dépend d'aucun module react-native/expo (Platform, Constants) : ces
 * valeurs sont résolues par l'appelant et passées en paramètres, pour que ce
 * module reste testable via node --test (comme le reste de utils/).
 */
export async function reportCrash(info: CrashReportInfo): Promise<void> {
  try {
    await fetch(buildApiUrl('/crash-reports'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: info.message,
        stack: info.stack,
        screen: info.screen,
        app_version: info.appVersion,
        platform: info.platform,
      }),
    }, 5000);
  } catch (reportError) {
    logger.error('[crashReporting] Failed to report crash', { reportError });
  }
}
