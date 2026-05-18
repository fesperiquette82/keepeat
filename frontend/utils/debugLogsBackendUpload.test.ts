import { uploadDebugLogsToBackend } from './debugLogsBackendUpload';
import { useAuthStore } from '../store/authStore';
import * as debugLogsExport from './debugLogsExport';

jest.mock('../store/authStore');
jest.mock('./debugLogsExport');
jest.mock('./logger');

global.fetch = jest.fn();

describe('uploadDebugLogsToBackend', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  it('should return error when not authenticated', async () => {
    (useAuthStore.getState as jest.Mock).mockReturnValue({ token: null });

    const result = await uploadDebugLogsToBackend();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Not authenticated');
  });

  it('should upload logs with valid authentication', async () => {
    const mockToken = 'test-token-12345';
    const mockLogsContent = '[INFO] Test logs\n[ERROR] Test error';

    (useAuthStore.getState as jest.Mock).mockReturnValue({ token: mockToken });
    (debugLogsExport.debugLogsExport.exportAsText as jest.Mock).mockReturnValue(mockLogsContent);
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          filename: '2026-05-18T12-30-45_test@example.com_keepeat_swipe_logs_2026-05-18_12-30-45.txt',
        }),
        { status: 200 }
      )
    );

    const result = await uploadDebugLogsToBackend();

    expect(result.success).toBe(true);
    expect(result.message).toContain('successfully');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/debug/logs/upload'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${mockToken}`,
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('should handle upload failure', async () => {
    const mockToken = 'test-token-12345';

    (useAuthStore.getState as jest.Mock).mockReturnValue({ token: mockToken });
    (debugLogsExport.debugLogsExport.exportAsText as jest.Mock).mockReturnValue('test logs');
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({ detail: 'Internal server error' }),
        { status: 500 }
      )
    );

    const result = await uploadDebugLogsToBackend();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to upload logs');
  });

  it('should handle network errors', async () => {
    const mockToken = 'test-token-12345';

    (useAuthStore.getState as jest.Mock).mockReturnValue({ token: mockToken });
    (debugLogsExport.debugLogsExport.exportAsText as jest.Mock).mockReturnValue('test logs');
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    const result = await uploadDebugLogsToBackend();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Network error');
  });

  it('should include timestamp and filename in request', async () => {
    const mockToken = 'test-token-12345';
    const mockLogsContent = '[INFO] Sample logs';

    (useAuthStore.getState as jest.Mock).mockReturnValue({ token: mockToken });
    (debugLogsExport.debugLogsExport.exportAsText as jest.Mock).mockReturnValue(mockLogsContent);
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          filename: '2026-05-18T12-30-45_test@example.com_keepeat_swipe_logs_2026-05-18_12-30-45.txt',
        }),
        { status: 200 }
      )
    );

    await uploadDebugLogsToBackend();

    const call = (global.fetch as jest.Mock).mock.calls[0];
    const requestBody = JSON.parse(call[1].body);

    expect(requestBody).toHaveProperty('content', mockLogsContent);
    expect(requestBody).toHaveProperty('filename');
    expect(requestBody.filename).toMatch(/keepeat_swipe_logs_/);
  });
});
