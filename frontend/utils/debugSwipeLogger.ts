import { DEBUG_SWIPE_ACTIONS, DEBUG_LOG_BUFFER_SIZE, DEBUG_LOG_TO_CONSOLE } from './debugConfig';

interface DebugLogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  module: string;
  action: string;
  details?: any;
}

class DebugSwipeLogger {
  private buffer: DebugLogEntry[] = [];
  private enabled: boolean = DEBUG_SWIPE_ACTIONS;

  constructor() {
    this.info('debugSwipeLogger', 'Logger initialized', {
      enabled: DEBUG_SWIPE_ACTIONS,
      bufferSize: DEBUG_LOG_BUFFER_SIZE,
    });
  }

  private addToBuffer(entry: DebugLogEntry) {
    if (!this.enabled) return;

    this.buffer.push(entry);
    if (this.buffer.length > DEBUG_LOG_BUFFER_SIZE) {
      this.buffer.shift();
    }

    if (DEBUG_LOG_TO_CONSOLE) {
      const prefix = `[${entry.level}] [${entry.module}] ${entry.action}`;
      const logData = entry.details ? JSON.stringify(entry.details, null, 2) : '';
      console.log(`${prefix} ${entry.timestamp}`, logData);
    }
  }

  info(module: string, action: string, details?: any) {
    this.addToBuffer({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      module,
      action,
      details,
    });
  }

  warn(module: string, action: string, details?: any) {
    this.addToBuffer({
      timestamp: new Date().toISOString(),
      level: 'WARN',
      module,
      action,
      details,
    });
  }

  error(module: string, action: string, details?: any) {
    this.addToBuffer({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      module,
      action,
      details,
    });
  }

  /**
   * Exporte tous les logs en JSON.
   * À copier-coller depuis la console ou envoyer à un serveur.
   */
  exportLogs(): string {
    return JSON.stringify(this.buffer, null, 2);
  }

  /**
   * Exporte les logs formatés en texte lisible.
   */
  exportLogsAsText(): string {
    return this.buffer
      .map(
        (entry) =>
          `[${entry.timestamp}] [${entry.level}] [${entry.module}] ${entry.action}\n${
            entry.details ? `  Details: ${JSON.stringify(entry.details)}\n` : ''
          }`,
      )
      .join('\n');
  }

  /**
   * Réinitialise le buffer (utile pour les tests).
   */
  clear() {
    this.buffer = [];
  }

  /**
   * Retourne le nombre de logs actuellement en buffer.
   */
  count(): number {
    return this.buffer.length;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.info('debugSwipeLogger', 'Logger toggled', { enabled });
  }

  getLogs(): DebugLogEntry[] {
    return [...this.buffer];
  }
}

// Instance singleton
export const debugSwipeLogger = new DebugSwipeLogger();

// Export d'une fonction globale pour facilement accéder aux logs depuis la console
declare global {
  interface Window {
    __KEEPEAT_DEBUG_LOGS__: {
      export: () => string;
      exportText: () => string;
      clear: () => void;
      toggle: (enabled: boolean) => void;
      count: () => number;
    };
  }
}

// Enregistrer les fonctions de debug dans window (si disponible)
if (typeof window !== 'undefined') {
  (window as any).__KEEPEAT_DEBUG_LOGS__ = {
    export: () => debugSwipeLogger.exportLogs(),
    exportText: () => debugSwipeLogger.exportLogsAsText(),
    clear: () => debugSwipeLogger.clear(),
    toggle: (enabled: boolean) => debugSwipeLogger.setEnabled(enabled),
    count: () => debugSwipeLogger.count(),
  };
}
