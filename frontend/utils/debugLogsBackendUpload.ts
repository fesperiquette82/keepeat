import { debugLogsExport } from './debugLogsExport';
import { logger } from './logger';
import { buildApiUrl } from './config';
import { useAuthStore } from '../store/authStore';
import { fetchWithTimeout as fetch } from './fetchWithTimeout';

/**
 * Sends debug logs to the backend API endpoint
 * Requires valid authentication token
 */
export async function uploadDebugLogsToBackend(): Promise<{ success: boolean; message: string }> {
  try {
    const { token } = useAuthStore.getState();

    if (!token) {
      return {
        success: false,
        message: 'Not authenticated. Please log in first.',
      };
    }

    const logsContent = debugLogsExport.exportAsText();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
    const filename = `keepeat_swipe_logs_${timestamp}_${time}.txt`;

    const payload = {
      content: logsContent,
      filename,
    };

    const apiUrl = buildApiUrl('/debug/logs/upload');

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logger.error('[debugLogsBackendUpload] Failed to upload logs', {
        status: response.status,
        error: (errorData as { detail?: string }).detail,
      });
      return {
        success: false,
        message: `Failed to upload logs: ${(errorData as { detail?: string }).detail || response.statusText}`,
      };
    }

    const result = (await response.json()) as { filename?: string };

    logger.info('[debugLogsBackendUpload] Successfully uploaded logs', {
      filename: result.filename,
      contentSize: logsContent.length,
    });

    return {
      success: true,
      message: `Debug logs uploaded successfully (${result.filename})`,
    };
  } catch (error) {
    logger.error('[debugLogsBackendUpload] Error uploading logs', { error });
    return {
      success: false,
      message: `Error uploading logs: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
