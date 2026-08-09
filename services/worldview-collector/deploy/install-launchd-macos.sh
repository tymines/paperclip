#!/usr/bin/env bash
# Deployment-held installer for the final selected always-on Mac mini.
# Run only after Tyler approves the Ares/Hermes host and LAN firewall rule.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${WORLDVIEW_PORT:-8788}"
HOST="${WORLDVIEW_HOST:-0.0.0.0}"
LABEL="com.paperclip.worldview-collector"
WATCH_LABEL="${LABEL}.watchdog"
ROTATE_LABEL="${LABEL}.logrotate"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/PaperclipWorldView"
HISTORY="$HOME/Library/Application Support/PaperclipWorldView/history"
NODE_BIN="$(command -v node)"
mkdir -p "$AGENTS" "$LOGS" "$HISTORY"
chmod +x "$HERE/deploy/watchdog.sh"

cat > "$AGENTS/$LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE_BIN</string><string>$HERE/server.mjs</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>WORLDVIEW_PORT</key><string>$PORT</string>
    <key>WORLDVIEW_HOST</key><string>$HOST</string>
    <key>WORLDVIEW_POLL_MS</key><string>${WORLDVIEW_POLL_MS:-300000}</string>
    <key>WORLDVIEW_HISTORY_DIR</key><string>$HISTORY</string>
  </dict>
  <key>WorkingDirectory</key><string>$HERE</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOGS/collector.out.log</string>
  <key>StandardErrorPath</key><string>$LOGS/collector.err.log</string>
</dict></plist>
PLIST

cat > "$AGENTS/$WATCH_LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$WATCH_LABEL</string>
  <key>ProgramArguments</key><array><string>$HERE/deploy/watchdog.sh</string></array>
  <key>EnvironmentVariables</key><dict><key>WORLDVIEW_PORT</key><string>$PORT</string><key>WORLDVIEW_LABEL</key><string>$LABEL</string></dict>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOGS/watchdog.log</string>
  <key>StandardErrorPath</key><string>$LOGS/watchdog.log</string>
</dict></plist>
PLIST

cat > "$AGENTS/$ROTATE_LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$ROTATE_LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE_BIN</string><string>$HERE/deploy/rotate-logs.mjs</string><string>$LOGS/collector.out.log</string><string>$LOGS/collector.err.log</string><string>$LOGS/watchdog.log</string></array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
</dict></plist>
PLIST

for service in "$LABEL" "$WATCH_LABEL" "$ROTATE_LABEL"; do
  launchctl bootout "gui/$(id -u)/$service" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$service.plist"
done

echo "Installed $LABEL on $HOST:$PORT"
echo "Health: curl --fail http://127.0.0.1:$PORT/health"
echo "DEPLOYMENT GATES STILL REQUIRED: selected Mac host, firewall allowlist, Paperclip WORLDVIEW_COLLECTOR_URL repoint, Windows decommission verification."
