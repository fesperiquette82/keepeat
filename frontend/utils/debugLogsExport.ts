import { debugSwipeLogger } from './debugSwipeLogger';

export interface DebugLogsExport {
  exportAsText: () => string;
  exportAsJSON: () => string;
  getLogs: () => any[];
  clearLogs: () => void;
}

export const debugLogsExport: DebugLogsExport = {
  exportAsText: () => {
    return debugSwipeLogger.exportLogsAsText();
  },

  exportAsJSON: () => {
    return debugSwipeLogger.exportLogs();
  },

  getLogs: () => {
    return debugSwipeLogger.getLogs();
  },

  clearLogs: () => {
    debugSwipeLogger.clear();
  },
};

// Expose globally for easy access from console
declare global {
  interface Window {
    __KEEPEAT_DEBUG_EXPORT__?: DebugLogsExport;
  }
}

if (typeof window !== 'undefined') {
  (window as any).__KEEPEAT_DEBUG_EXPORT__ = debugLogsExport;
}
