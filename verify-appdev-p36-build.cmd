@echo off
REM ── Verify fable/appdev-studio-p36 (App Dev Phases 3-6) with the real build ──
REM Pattern: .worktrees/kg-brain/verify-kg-build.cmd. Runs entirely inside this
REM isolated worktree; touches nothing live. Migrations 0146 + 0151 stay
REM UNAPPLIED (gated) — nothing here runs them.
cd /d "%~dp0"
echo === pnpm install (worktree-local node_modules) ===
call pnpm install --frozen-lockfile || goto :fail
echo === shared + db: build (schema touched: appdev_screen_baselines) ===
call pnpm --filter @paperclipai/shared run build || goto :fail
call pnpm --filter @paperclipai/db run build || goto :fail
echo === server: tsc ===
call pnpm --filter @paperclipai/server exec tsc --noEmit || goto :fail
echo === ui: tsc -b ^&^& vite build ===
call pnpm --filter ./ui run build || goto :fail
echo.
echo BUILD PASSED — appdev phases 3-6 worktree is green
pause
exit /b 0
:fail
echo.
echo BUILD FAILED — see errors above
pause
exit /b 1
