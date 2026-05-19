import { DEBUG_SWIPE_ACTIONS, DEBUG_LOG_BUFFER_SIZE, DEBUG_LOG_TO_CONSOLE } from './debugConfig';

// Conditional imports for Node.js test compatibility
class FallbackFile implements FileInterface {
  uri: string = '';
  constructor(path?: string, filename?: string) {
    this.uri = path && filename ? `${path}/${filename}` : '';
  }
  write(_content: string, _options?: any) {}
  async text(): Promise<string> { return ''; }
  delete() {}
}

interface FilesystemPaths {
  document: string;
}

interface SharingInterface {
  isAvailableAsync(): Promise<boolean>;
  shareAsync(uri: string, options: any): Promise<void>;
}

interface PlatformInterface {
  OS: string;
}

let File: typeof FallbackFile;
let Paths: FilesystemPaths;
let Sharing: SharingInterface;
let Platform: PlatformInterface;

try {
  const expoFS = require('expo-file-system');
  File = expoFS.File;
  Paths = expoFS.Paths;
} catch {
  // Fallback for Node.js test environment
  File = FallbackFile;
  Paths = { document: '/documents' };
}

try {
  Sharing = require('expo-sharing');
} catch {
  // Fallback for Node.js test environment
  Sharing = {
    isAvailableAsync: async () => false,
    shareAsync: async () => {},
  };
}

try {
  Platform = require('react-native').Platform;
} catch {
  // Fallback for Node.js test environment
  Platform = { OS: 'web' };
}

interface DebugLogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  module: string;
  action: string;
  details?: any;
}

interface FileInterface {
  uri: string;
  write(content: string, options?: any): void;
  text(): Promise<string>;
  delete(): void;
}

function buildLogFileName(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').split('T')[0];
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  return `keepeat_swipe_logs_${timestamp}_${time}.txt`;
}

class DebugSwipeLogger {
  private buffer: DebugLogEntry[] = [];
  private enabled: boolean = DEBUG_SWIPE_ACTIONS;
  private flushIntervalId: NodeJS.Timeout | null = null;
  private fileInitialized: boolean = false;
  private logFile: FileInterface | null = null;
  private fallbackUsed: boolean = false;

  constructor() {
    this.initializeFile();
    this.startAutoFlush();
    this.info('debugSwipeLogger', 'Logger initialized', {
      enabled: DEBUG_SWIPE_ACTIONS,
      bufferSize: DEBUG_LOG_BUFFER_SIZE,
    });
  }

  private async initializeFile() {
    const filename = buildLogFileName();

    if (Platform.OS === 'android') {
      try {
        const downloadPath = '/storage/emulated/0/Download';
        this.logFile = new (File as any)(downloadPath, filename);
        this.logFile!.write(
          `KeepEat Debug Logs - Session started ${new Date().toISOString()}\n${'='.repeat(80)}\n\n`,
        );
        this.fileInitialized = true;
        console.log('[DebugSwipeLogger] Log file created in Download folder:', this.logFile!.uri);
        return;
      } catch (err) {
        console.warn('[DebugSwipeLogger] Could not write to Download folder, using app documents folder as fallback:', err);
        this.fallbackUsed = true;
      }
    }

    try {
      this.logFile = new (File as any)(Paths.document, filename);
      this.logFile!.write(
        `KeepEat Debug Logs - Session started ${new Date().toISOString()}\n${'='.repeat(80)}\n\n`,
      );
      this.fileInitialized = true;
      console.log('[DebugSwipeLogger] Log file created in app documents folder:', this.logFile!.uri);
    } catch (err) {
      console.error('[DebugSwipeLogger] Failed to initialize log file:', err);
      this.fileInitialized = false;
    }
  }

  private startAutoFlush() {
    if (this.flushIntervalId) return;
    // Only start auto-flush if not in test environment
    if (typeof window !== 'undefined' || typeof document !== 'undefined') {
      this.flushIntervalId = setInterval(() => {
        this.flushToFile();
      }, 3000);
    }
  }

  private stopAutoFlush() {
    if (this.flushIntervalId) {
      clearInterval(this.flushIntervalId);
      this.flushIntervalId = null;
    }
  }

  private flushToFile() {
    if (this.buffer.length === 0 || !this.fileInitialized || !this.logFile) return;

    try {
      const content = this.buffer
        .map(
          (entry) =>
            `[${entry.timestamp}] [${entry.level}] [${entry.module}] ${entry.action}${
              entry.details ? `\n  ${JSON.stringify(entry.details)}` : ''
            }`,
        )
        .join('\n');

      if (this.logFile) {
        this.logFile.write(`${content}\n`, { append: true });
      }
    } catch (err) {
      console.warn('[DebugSwipeLogger] Failed to flush to file:', err);
    }
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

  exportLogs(): string {
    return JSON.stringify(this.buffer, null, 2);
  }

  exportLogsAsText(): string {
    return this.buffer
      .map(
        (entry) =>
          `[${entry.timestamp}] [${entry.level}] [${entry.module}] ${entry.action}${
            entry.details ? `\n  ${JSON.stringify(entry.details)}` : ''
          }`,
      )
      .join('\n');
  }

  clear() {
    this.buffer = [];
  }

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

  getFilePath(): string {
    return this.logFile?.uri || 'File not initialized';
  }

  isFallbackUsed(): boolean {
    return this.fallbackUsed;
  }

  async readLogsFromFile(): Promise<string> {
    try {
      if (!this.logFile) return 'Log file not initialized';
      const content = await this.logFile.text();
      return content;
    } catch (err) {
      return `Failed to read logs file: ${err}`;
    }
  }

  async shareLogsFile(): Promise<void> {
    try {
      if (!this.logFile) {
        console.warn('[DebugSwipeLogger] Log file not initialized');
        return;
      }

      this.forceFlush();
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        console.warn('[DebugSwipeLogger] Sharing not available on this device');
        return;
      }

      await Sharing.shareAsync(this.logFile.uri, {
        mimeType: 'text/plain',
        dialogTitle: 'Share KeepEat Debug Logs',
        UTI: 'com.apple.mail.email.txt',
      });
    } catch (err) {
      console.error('[DebugSwipeLogger] Failed to share logs:', err);
    }
  }

  async clearLogsFile(): Promise<void> {
    try {
      if (this.logFile) {
        this.logFile.delete();
      }
      this.buffer = [];
      await this.initializeFile();
      this.info('debugSwipeLogger', 'Logs file cleared and reinitialized', {});
    } catch (err) {
      console.error('[DebugSwipeLogger] Failed to clear logs file:', err);
    }
  }

  forceFlush(): void {
    this.flushToFile();
  }
}

export const debugSwipeLogger = new DebugSwipeLogger();

declare global {
  interface Window {
    __KEEPEAT_DEBUG_LOGS__: {
      export: () => string;
      exportText: () => string;
      clear: () => void;
      toggle: (enabled: boolean) => void;
      count: () => number;
      filePath: () => string;
      isFallback: () => boolean;
      readFile: () => Promise<string>;
      shareFile: () => Promise<void>;
      clearFile: () => Promise<void>;
      flush: () => void;
    };
  }
}

if (typeof window !== 'undefined') {
  (window as any).__KEEPEAT_DEBUG_LOGS__ = {
    export: () => debugSwipeLogger.exportLogs(),
    exportText: () => debugSwipeLogger.exportLogsAsText(),
    clear: () => debugSwipeLogger.clear(),
    toggle: (enabled: boolean) => debugSwipeLogger.setEnabled(enabled),
    count: () => debugSwipeLogger.count(),
    filePath: () => debugSwipeLogger.getFilePath(),
    isFallback: () => debugSwipeLogger.isFallbackUsed(),
    readFile: () => debugSwipeLogger.readLogsFromFile(),
    shareFile: () => debugSwipeLogger.shareLogsFile(),
    clearFile: () => debugSwipeLogger.clearLogsFile(),
    flush: () => debugSwipeLogger.forceFlush(),
  };
}
