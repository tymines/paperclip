# Cloudflare tunnel ingress fix — status note

Date: 2026-05-25
Branch: codex/v2-tz-et-and-tunnel

## What we wanted
Repoint the dashboard-managed `augiport-tunnel` (ID `a9659018-f34d-4a9e-9939-72882b1776e4`)
ingress rule for `paperclip.augiport.com` from `http://localhost:5173` →
`http://localhost:3100`, so we can retire the TCP forwarder at
`/Users/augi/.paperclip/proxy-5173-to-3100.js` and its `com.paperclip.port-proxy`
launchd agent. That forwarder causes a 5–15s 502 window on every API restart.

## What actually happened
The tunnel is dashboard-defined (`cloudflared tunnel run --token …` on PID 576,
running as root via launchd) — config lives in Cloudflare, not in the local
`~/.cloudflared/config.yml` (which has the correct mapping but is unused by
the running tunnel). Updating the config requires a Cloudflare API token.

Searched for a token in: shell rc files (`~/.zshrc`, `~/.zshenv`, `~/.bashrc`,
`~/.bash_profile`, `~/.profile`), env (`printenv | grep -i cloudflare|^CF_`),
paperclip envs (`/Users/augi/paperclip/.env`, `.env.example`,
`/Users/augi/.paperclip/*.json`), 1Password CLI (not signed in), and
`~/.cloudflared/` (only `config.yml` + `credentials.json`, no `cert.pem` so
`cloudflared tunnel list` also fails). **No token found.**

Per the task instructions, did not prompt for a token. Instead wrote
`/Users/augi/.openclaw/agents/codex/workspace/cloudflare-fix-manual-steps.md`
with the dashboard click-path Tyler can follow in ~30 seconds.

## What was NOT done (deliberately)
- Did not unload `com.paperclip.port-proxy` (PID 711, node 5173→3100 forwarder).
  Still load-bearing until the dashboard ingress is updated.
- Did not unload the dead `com.paperclip.cloudflared` (PID 717, quick-tunnel to
  :5174). Per task wording both teardowns are under the "if verified" branch
  from step 4; skipping until tunnel reconfig is confirmed.

## Follow-up
After Tyler clicks through the dashboard steps and verifies 200 on
`paperclip.augiport.com`, the launchd cleanup is:

  launchctl unload ~/Library/LaunchAgents/com.paperclip.port-proxy.plist
  launchctl unload ~/Library/LaunchAgents/com.paperclip.cloudflared.plist
  rm ~/Library/LaunchAgents/com.paperclip.port-proxy.plist
  rm ~/Library/LaunchAgents/com.paperclip.cloudflared.plist
  rm /Users/augi/.paperclip/proxy-5173-to-3100.js
  # node forwarder (PID 711) + dead quick-tunnel (PID 717) exit on unload.
