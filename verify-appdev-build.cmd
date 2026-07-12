@echo off
REM ── Verify the fable/appdev-control-center worktree with the real build ──
REM Mirrors .worktrees/kg-brain/verify-kg-build.cmd. Runs entirely inside this
REM isolated worktree. Does not touch the live tree, the running server, or
REM the DB. Migration 0146 stays UNAPPLIED (gated) — nothing here runs it.
cd /d "%~dp0"
echo === pnpm install (worktree-local node_modules) ===
call pnpm install --frozen-lockfile || goto :fail
echo === shared + db: build (schema/constants touched) ===
call pnpm --filter @paperclipai/shared run build || goto :fail
call pnpm --filter @paperclipai/db run build || goto :fail
echo === server: tsc ===
call pnpm --filter @paperclipai/server exec tsc --noEmit || goto :fail
echo === ui: tsc -b ^&^& vite build ===
call pnpm --filter ./ui run build || goto :fail
echo.
echo BUILD PASSED — appdev control center worktree is green
pause
exit /b 0
:fail
echo.
echo BUILD FAILED — see errors above
pause
exit /b 1
