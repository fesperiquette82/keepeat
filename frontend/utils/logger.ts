import { APP_CONFIG } from './appConfig';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const minLevel: LogLevel = APP_CONFIG.enableVerboseLogs ? 'debug' : 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[minLevel];
}

function sanitizeError(error: unknown): { message: string; name?: string } {
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }
  return { message: String(error) };
}

function emit(level: LogLevel, message: string, payload?: unknown) {
  if (!shouldLog(level)) return;
  const prefix = `[${level.toUpperCase()}]`;
  if (payload === undefined) {
    console[level](`${prefix} ${message}`);
    return;
  }
  console[level](`${prefix} ${message}`, payload);
}

export const logger = {
  debug(message: string, payload?: unknown) {
    emit('debug', message, payload);
  },
  info(message: string, payload?: unknown) {
    emit('info', message, payload);
  },
  warn(message: string, payload?: unknown) {
    emit('warn', message, payload);
  },
  error(message: string, payload?: unknown) {
    emit('error', message, payload);
  },
  errorFromException(message: string, error: unknown) {
    emit('error', message, sanitizeError(error));
  },
};

