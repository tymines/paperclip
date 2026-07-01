#!/usr/bin/env bash
# Install the collector as a launchd service on augibot2 (macOS).
# Keeps it running + restarts on crash/login. Run as the normal user (NOT sudo).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${WORLDVIEW_PORT:-8788}"
LABEL="com.paperclip.worldview-collector"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE_BIN="$(command -v node)"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.worldview-logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$NODE_BIN</string><string>$HERE/server.mjs</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>WORLDVIEW_PORT</key><string>$PORT</string>
    <key>WORLDVIEW_POLL_MS</key><string>${WORLDVIEW_POLL_MS:-300000}</string>
  </dict>
  <key>WorkingDirectory</key><string>$HERE</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.worldview-logs/collector.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/.worldview-logs/collector.err.log</string>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Loaded $LABEL on port $PORT."
echo "Tailnet URL for Box 1:  http://\$(hostname -s | tr 'A-Z' 'a-z').<your-tailnet>.ts.net:$PORT"
echo "Health check:           curl -s http://localhost:$PORT/health"
