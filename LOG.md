# 📋 KeepEat Logs Reference

## Location
All workflow logs are automatically downloaded to: `LOGS/` directory

Latest runs are in subdirectories named `logs_XXXXXXXXX/` ordered by timestamp.

## Quick Access

### Latest Log Directory
```bash
ls -lat LOGS/ | head -5
```

### View Latest Build/Test Results
```bash
ls LOGS/logs_*/  # Shows all log directories with their contents
```

## Current Issues (2026-05-12)

### 1. **Android R8 Minification Error** (logs_68591306175)
- **Status**: FAILED - 2026-05-12T11:41:16
- **Error**: Missing classes during R8 compilation
- **Root Cause**: Expo modules classes not being kept by ProGuard rules
- **Classes Missing**:
  - `expo.modules.kotlin.runtime.Runtime`
  - `expo.modules.kotlin.services.FilePermissionService`
  - `expo.modules.kotlin.services.FilePermissionService$Permission`
- **Location**: `frontend/android/app/build/outputs/mapping/release/missing_rules.txt`
- **Fix Applied**: Added keep rules to `backend/proguard-rules.pro` (but may need frontend rules too)
- **Next Steps**: Review `frontend/android/app/proguard-rules.pro` to ensure Expo classes are preserved

### 2. **Production Deployment ModuleNotFoundError** (Previous - FIXED)
- **Status**: FIXED - Commit 06e9ac1
- **Error**: `ModuleNotFoundError: No module named 'backend'`
- **Fix**: Shell wrapper in render.yaml sets PYTHONPATH before uvicorn starts
- **Command**: `sh -c 'export PYTHONPATH=$PWD && python -m uvicorn asgi:app ...'`

### 3. **Test Suite Issues** (Previous - FIXED)
- **Status**: FIXED - Commits 64bc22a, 235a21c
- **Issues Fixed**:
  - 6 incorrect mock patch paths (server.* → backend.server.*)
  - 1 missing package import (test_mode)
  - warmup_ping import path
  - Missing `__init__.py` in backend/scripts/

## How to Access Logs

### Using Bash
```bash
# Go to project
cd "c:/Perso/PERSO-USB/Projets/KeepEat/KeepEat-main/keepeat"

# List all log directories
ls LOGS/

# View latest summary (first few lines of build)
head -50 LOGS/logs_*/0_*.txt

# View latest error (last few lines of build)  
tail -100 LOGS/logs_*/0_*.txt

# Search for specific errors
grep -r "ERROR\|FAILED" LOGS/logs_*/ --include="*.txt"
```

### ⚠️ Clean Up After Processing
Once issues are analyzed, fixed, and verified to be resolved:
```bash
# Delete processed log directories
rm -rf LOGS/logs_*
rm -f LOGS/*.zip
```

**Important**: Only delete after:
1. ✅ Issue has been identified and fixed in code
2. ✅ Fix has been committed and pushed
3. ✅ Workflow has been re-run to confirm fix works
4. ✅ New logs show issue is resolved (no errors)

### Finding Specific Job Logs
Structure: `LOGS/logs_XXXXXXXXX/`
- `0_*.txt` = Main job summary
- Subdirectories contain detailed logs for each step

## Commits Applied
| Commit | Date | Issue | Fix |
|--------|------|-------|-----|
| 64bc22a | 2026-05-12 | 7 test failures | Corrected mock patch paths + imports |
| 235a21c | 2026-05-12 | warmup_ping import | Fixed backend/scripts import path |
| 06e9ac1 | 2026-05-12 | Production deployment | Shell wrapper sets PYTHONPATH |

## Next Actions
1. Check frontend Android R8 rules for Expo modules
2. Verify shell wrapper works on Render deployment
3. Run test suite to confirm all tests pass
