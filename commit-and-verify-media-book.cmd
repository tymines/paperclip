@echo off
REM ── Social media uploads + Book Studio deferred set: host-side commit + verify ──
REM Same pattern as .worktrees/social-studio/commit-and-verify-social-build.cmd:
REM the sandbox's Linux mirror serves stale/truncated copies of fresh edits, so
REM commit AND build both run here on the host where files are correct.
REM Isolated worktree on fable-media-book-build (base: fable-integration).
REM No migrations applied — 0151_book_annotations.sql is written+journaled, GATED.

setlocal
set WT=C:\Users\Augi-T1\paperclip\.worktrees\media-book
set GD=C:\Users\Augi-T1\paperclip\.git\worktrees\media-book

echo === 1/5 repair git pointers (sandbox wrote Linux paths) ===
echo gitdir: C:/Users/Augi-T1/paperclip/.git/worktrees/media-book> "%WT%\.git"
echo C:/Users/Augi-T1/paperclip/.worktrees/media-book/.git> "%GD%\gitdir"
if exist "%GD%\index" del /f /q "%GD%\index"
if exist "%GD%\index.lock" del /f /q "%GD%\index.lock"
if exist "%GD%\HEAD.lock" del /f /q "%GD%\HEAD.lock"
if exist "%GD%\locked" del /f /q "%GD%\locked"

cd /d "%WT%" || goto :fail

echo === 2/5 git status sanity ===
git status --short | find /c /v "" || goto :fail

echo === 3/5 commit both parts ===
git add -A || goto :fail
git -c user.name="Fable" -c user.email="fleet@paperclip.local" commit -m "feat(social+book): real media uploads (X/FB/IG/Threads/Reddit incl. carousel+video) + Book deferred set (0151 gated annotations, 3-state autonomy dial, SSE draft streaming)" || echo (nothing to commit is OK if already committed)

echo === 4/5 pnpm install (worktree-local node_modules) ===
call pnpm install --frozen-lockfile || goto :fail

echo === 5/5 real build: server tsc + ui tsc -b ^&^& vite build ===
call pnpm --filter @paperclipai/server exec tsc --noEmit || goto :fail
call pnpm --filter ./ui run build || goto :fail

echo.
echo ===============================
echo   BUILD PASSED — commit is in fable-media-book-build (NOT merged anywhere)
echo ===============================
pause
exit /b 0

:fail
echo.
echo ===============================
echo   FAILED — see errors above. Worktree is isolated; nothing else affected.
echo ===============================
pause
exit /b 1
