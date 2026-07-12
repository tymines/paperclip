@echo off
REM ── Verify the fable/influencer-studio-revamp worktree with the real build ──
REM Runs entirely inside this isolated worktree. Does not touch the live
REM tree, the running server, or the DB.
REM NOTE: the sandbox session left node_modules SYMLINKS pointing at the live
REM tree. The rmdir calls below remove only the links (non-recursive), so a
REM worktree-local install can proceed safely.
cd /d "%~dp0"
if exist node_modules rmdir node_modules 2>nul
if exist ui\node_modules rmdir ui\node_modules 2>nul
echo === pnpm install (worktree-local node_modules) ===
call pnpm install --frozen-lockfile || goto :fail
echo === server: tsc ===
call pnpm --filter @paperclipai/server exec tsc --noEmit || goto :fail
echo === ui: tsc -b ^&^& vite build ===
call pnpm --filter ./ui run build || goto :fail
echo.
echo ✅ BUILD PASSED
pause
exit /b 0
:fail
echo.
echo ❌ BUILD FAILED — see errors above
pause
exit /b 1
