# Hermes Cost Telemetry Plugin

This is a supported Hermes user plugin for the local Paperclip cost dashboard lane. It records per-API-call speed samples in a sidecar SQLite database and leaves Hermes `state.db` read-only.

## Install

Copy or symlink this directory into the Hermes user-plugin location for the profile you want Paperclip to observe. Set `PAPERCLIP_RUN_ID` in the Paperclip-launched heartbeat environment so the hook can stamp API calls with the originating run.

The plugin writes:

```text
$HERMES_HOME/cost-dashboard/telemetry.sqlite3
```

Set `HERMES_COST_TELEMETRY_DB_PATH` when Paperclip and the plugin should use a non-default sidecar path. The plugin and server honor the same override.

Paperclip reads Hermes aggregate billing data from:

```text
$HERMES_STATE_DB_PATH
# default: ~/.hermes/state.db
```

and per-call telemetry from:

```text
$HERMES_COST_TELEMETRY_DB_PATH
# default: ~/.hermes/cost-dashboard/telemetry.sqlite3
```

The Paperclip local endpoint also requires `HERMES_COST_COMPANY_ID=<company-id>`. This binds the global local Hermes database to one Paperclip company and fails closed when missing or mismatched.

The sidecar table is idempotent on `(session_id, api_request_id)`, so replayed hook deliveries do not duplicate observations. Missing sidecar data is treated as unavailable latency/TTFT rather than fabricated zero-speed metrics.
