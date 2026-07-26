"""Durable per-API-call telemetry for Paperclip's local Hermes cost dashboard."""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Mapping


_DB_LOCK = threading.Lock()
_SCHEMA = """
CREATE TABLE IF NOT EXISTS api_calls (
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    api_request_id TEXT NOT NULL,
    paperclip_run_id TEXT,
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    cache_read_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
    cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
    reasoning_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
    started_at REAL NOT NULL,
    ended_at REAL NOT NULL,
    api_duration REAL NOT NULL CHECK (api_duration >= 0),
    ttft REAL CHECK (ttft IS NULL OR ttft >= 0),
    created_at REAL NOT NULL,
    PRIMARY KEY (session_id, api_request_id)
);
CREATE INDEX IF NOT EXISTS api_calls_paperclip_run_idx
    ON api_calls (paperclip_run_id, started_at);
CREATE INDEX IF NOT EXISTS api_calls_session_turn_idx
    ON api_calls (session_id, turn_id, started_at);
"""


def _hermes_home() -> Path:
    configured = os.environ.get("HERMES_HOME")
    return Path(configured).expanduser() if configured else Path.home() / ".hermes"


def telemetry_db_path() -> Path:
    configured = os.environ.get("HERMES_COST_TELEMETRY_DB_PATH")
    if configured:
        return Path(configured).expanduser()
    return _hermes_home() / "cost-dashboard" / "telemetry.sqlite3"


def _nonnegative_int(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError, OverflowError):
        return 0


def _nonnegative_float(value: Any) -> float:
    try:
        parsed = float(value or 0)
    except (TypeError, ValueError, OverflowError):
        return 0.0
    return max(0.0, parsed)


def _nullable_nonnegative_float(value: Any) -> float | None:
    if value is None:
        return None
    parsed = _nonnegative_float(value)
    return parsed


def _usage_value(usage: Mapping[str, Any], *keys: str) -> int:
    for key in keys:
        if key in usage and usage[key] is not None:
            return _nonnegative_int(usage[key])
    return 0


def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        path.parent.chmod(0o700)
    except OSError:
        pass

    db = sqlite3.connect(path, timeout=5.0)
    db.execute("PRAGMA busy_timeout = 5000")
    db.execute("PRAGMA journal_mode = WAL")
    db.execute("PRAGMA synchronous = NORMAL")
    db.executescript(_SCHEMA)
    db.commit()
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return db


def on_post_api_request(**kwargs: Any) -> None:
    """Persist one successful API-call observation without touching state.db."""

    session_id = str(kwargs.get("session_id") or "").strip()
    turn_id = str(kwargs.get("turn_id") or "").strip()
    api_request_id = str(kwargs.get("api_request_id") or "").strip()
    if not session_id or not turn_id or not api_request_id:
        return

    usage_value = kwargs.get("usage")
    usage: Mapping[str, Any] = usage_value if isinstance(usage_value, Mapping) else {}
    started_at = _nonnegative_float(kwargs.get("started_at"))
    api_duration = _nonnegative_float(kwargs.get("api_duration"))
    ended_at = _nonnegative_float(kwargs.get("ended_at"))
    if ended_at == 0 and started_at > 0:
        ended_at = started_at + api_duration

    record = (
        session_id,
        turn_id,
        api_request_id,
        (os.environ.get("PAPERCLIP_RUN_ID") or None),
        str(kwargs.get("response_model") or kwargs.get("model") or "unknown"),
        str(kwargs.get("provider") or "unknown"),
        _usage_value(usage, "input_tokens", "prompt_tokens"),
        _usage_value(usage, "output_tokens", "completion_tokens"),
        _usage_value(usage, "cache_read_tokens", "cached_input_tokens"),
        _usage_value(usage, "cache_write_tokens", "cache_creation_input_tokens"),
        _usage_value(usage, "reasoning_tokens"),
        started_at,
        ended_at,
        api_duration,
        _nullable_nonnegative_float(kwargs.get("ttft")),
        time.time(),
    )

    with _DB_LOCK:
        db = _connect(telemetry_db_path())
        try:
            db.execute(
                """
                INSERT OR IGNORE INTO api_calls (
                    session_id, turn_id, api_request_id, paperclip_run_id,
                    model, provider, input_tokens, output_tokens,
                    cache_read_tokens, cache_write_tokens, reasoning_tokens,
                    started_at, ended_at, api_duration, ttft, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                record,
            )
            db.commit()
        finally:
            db.close()


def register(ctx: Any) -> None:
    ctx.register_hook("post_api_request", on_post_api_request)
