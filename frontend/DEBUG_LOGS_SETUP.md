# Debug Logs Export Setup

## Overview

The app now includes a feature to export swipe gesture debug logs directly to GitHub. When enabled, users can click the "📤 Export Logs" button in Settings to upload logs as a GitHub Issue.

## Configuration

To enable this feature, add the following environment variables to your `.env.local`:

```bash
# GitHub token with repository access (generate at https://github.com/settings/tokens)
# Required scopes: repo (full control of private repositories)
EXPO_PUBLIC_GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Repository where issues will be created (format: owner/repo)
# Defaults to: fesperiquette82/keepeat
EXPO_PUBLIC_GITHUB_REPO=fesperiquette82/keepeat
```

## Getting a GitHub Token

1. Go to https://github.com/settings/tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Give it a descriptive name: `KeepEat Debug Logs Export`
4. Select scopes:
   - ✅ `repo` (Full control of private repositories)
   - ✅ `read:user` (Read user profile data)
5. Copy the token and add to `.env.local`

## How It Works

1. User taps "📤 Export Logs" in Settings
2. App collects all debug logs from the swipe gesture logger
3. Creates a new GitHub Issue in the configured repository with:
   - Title: `[DEBUG] Swipe gesture logs - <timestamp>`
   - Body: Formatted logs with timestamp and character count
   - Labels: `debug-logs`, `swipe-gesture`
4. User sees a confirmation with a link to the created issue

## Privacy

- Issues are created in a **private repository** (fesperiquette82/keepeat is private)
- Only you and Claude can access these logs
- Logs contain:
  - Timestamp of export
  - Gesture state transitions
  - Ref lifecycle information
  - No sensitive user data

## Troubleshooting

**"GitHub token not configured"**
- Add `EXPO_PUBLIC_GITHUB_TOKEN` to `.env.local` and rebuild app

**"Failed to create GitHub issue: 401"**
- Token has expired or is invalid
- Generate a new token at https://github.com/settings/tokens

**"Failed to create GitHub issue: 403"**
- Token doesn't have sufficient permissions
- Regenerate with `repo` scope

**Logs are truncated**
- If logs exceed 60KB, they are truncated with a notice
- Increase `maxLength` in `debugLogsGitHubSync.ts` if needed
