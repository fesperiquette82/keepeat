import { debugLogsExport } from './debugLogsExport';
import { logger } from './logger';
import { fetchWithTimeout as fetch } from './fetchWithTimeout';

/**
 * Sends debug logs to GitHub by creating a private GitHub Discussion
 * Requires EXPO_PUBLIC_GITHUB_TOKEN and EXPO_PUBLIC_GITHUB_REPO environment variables
 */
export async function shareDebugLogsToGitHub(): Promise<{ success: boolean; message: string; url?: string }> {
  try {
    const token = process.env.EXPO_PUBLIC_GITHUB_TOKEN;
    const repo = process.env.EXPO_PUBLIC_GITHUB_REPO || 'fesperiquette82/keepeat-debug-logs';

    if (!token) {
      return {
        success: false,
        message: 'GitHub token not configured. Please set EXPO_PUBLIC_GITHUB_TOKEN environment variable.',
      };
    }

    const logs = debugLogsExport.exportAsText();
    const timestamp = new Date().toISOString();
    const title = `[DEBUG] Swipe gesture logs - ${timestamp}`;

    // Truncate logs if too long (GitHub API limit is 65536 characters)
    const maxLength = 60000;
    const truncatedLogs = logs.length > maxLength
      ? logs.slice(-maxLength) + `\n\n[... truncated ${logs.length - maxLength} characters ...]`
      : logs;

    const body = `# KeepEat Swipe Gesture Debug Logs

**Timestamp**: ${timestamp}

## Debug Logs

\`\`\`
${truncatedLogs}
\`\`\`

**Character count**: ${logs.length}
**Device**: Android (from Expo)
`;

    // Create GitHub issue in private repo
    const [owner, repoName] = repo.split('/');
    const createIssueUrl = `https://api.github.com/repos/${owner}/${repoName}/issues`;

    const response = await fetch(createIssueUrl, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        body,
        labels: ['debug-logs', 'swipe-gesture'],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json() as { message?: string };
      logger.error('[debugLogsGitHubSync] Failed to create GitHub issue', {
        status: response.status,
        error: errorData.message,
      });
      return {
        success: false,
        message: `Failed to create GitHub issue: ${errorData.message || response.statusText}`,
      };
    }

    const issue = (await response.json()) as { html_url?: string; number?: number };
    const issueUrl = issue.html_url || `https://github.com/${repo}/issues/${issue.number}`;

    logger.info('[debugLogsGitHubSync] Successfully created GitHub issue', {
      issueNumber: issue.number,
      url: issueUrl,
    });

    return {
      success: true,
      message: `Debug logs uploaded! Issue #${issue.number} created.`,
      url: issueUrl,
    };
  } catch (error) {
    logger.error('[debugLogsGitHubSync] Error uploading logs', { error });
    return {
      success: false,
      message: `Error uploading logs: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
