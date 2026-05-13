import { debugSwipeLogger } from './debugSwipeLogger';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export interface DebugLogsExport {
  exportAsText: () => string;
  exportAsJSON: () => string;
  shareLogsFile: () => Promise<void>;
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

  shareLogsFile: async () => {
    try {
      const text = debugSwipeLogger.exportLogsAsText();
      const filename = `keepeat_swipe_debug_${new Date().toISOString().split('T')[0]}.txt`;
      const filePath = `${FileSystem.documentDirectoryPath}/${filename}`;

      await FileSystem.writeAsStringAsync(filePath, text, { encoding: FileSystem.EncodingType.UTF8 });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(filePath, {
          mimeType: 'text/plain',
          dialogTitle: 'Share KeepEat Debug Logs',
        });
      }
    } catch (err) {
      console.error('[debugLogsExport] Failed to share logs:', err);
    }
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
