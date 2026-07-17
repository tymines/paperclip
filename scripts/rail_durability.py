#!/usr/bin/env python3
"""Durable JSONL journal and atomic RAIL state projection. Stdlib only."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path


def _events(path: Path):
    if not path.exists():
        return []
    lines = path.read_bytes().splitlines(keepends=True)
    events = []
    last_cursor = 0
    for index, raw in enumerate(lines):
        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            if index == len(lines) - 1 and not raw.endswith((b"\n", b"\r")):
                break
            raise
        cursor = event.get("cursor")
        if not isinstance(cursor, int) or cursor != last_cursor + 1:
            raise ValueError(f"non-monotonic RAIL cursor at line {index + 1}: {cursor!r}")
        last_cursor = cursor
        events.append(event)
    return events


def _repair_tail(path: Path) -> None:
    if not path.exists() or path.stat().st_size == 0:
        return
    with path.open("rb+") as stream:
        data = stream.read()
        if data.endswith(b"\n"):
            return
        tail_start = data.rfind(b"\n") + 1
        try:
            json.loads(data[tail_start:])
        except json.JSONDecodeError:
            stream.seek(tail_start)
            stream.truncate()
        else:
            stream.seek(0, os.SEEK_END)
            stream.write(b"\n")
        stream.flush()
        os.fsync(stream.fileno())


def append_event(path: Path, event: dict) -> dict:
    """Append one fsynced event and assign the next monotonic cursor."""
    path.parent.mkdir(parents=True, exist_ok=True)
    _repair_tail(path)
    # ponytail: one controller owns this journal; scan the small file until rotation is needed.
    existing = _events(path)
    row = {"cursor": existing[-1]["cursor"] + 1 if existing else 1, **event}
    with path.open("a", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(row, separators=(",", ":"), default=str) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    return row


def atomic_write_json(path: Path, value: dict) -> None:
    """Write JSON through a same-directory temp file, fsync, then replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False
        ) as stream:
            temp_name = stream.name
            json.dump(value, stream, indent=2, default=str)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, path)
        temp_name = None
        try:
            directory_fd = os.open(path.parent, os.O_RDONLY)
        except OSError:
            return  # Windows cannot fsync directories.
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)


def load_projection(journal: Path, state_file: Path) -> dict:
    """Load state and replay journal rows newer than its persisted cursor."""
    try:
        state = json.loads(state_file.read_text(encoding="utf-8")) if state_file.exists() else {}
    except (OSError, json.JSONDecodeError):
        state = {}
    cursor = int(state.get("_meta", {}).get("cursor", 0))
    changed = False
    for event in _events(journal):
        if event["cursor"] <= cursor:
            continue
        cursor = event["cursor"]
        meta = state.setdefault("_meta", {})
        meta.update({"cursor": cursor, "last_event": event})
        if event.get("controller_epoch") is not None:
            meta["controller_epoch"] = event["controller_epoch"]
        if str(event.get("type", "")).startswith("controller."):
            meta["controller_heartbeat_at"] = event.get("ts")
        task_id = event.get("task_id")
        if task_id and task_id != "system":
            state.setdefault(task_id, {})["last_event"] = {
                "cursor": cursor,
                "ts": event.get("ts"),
                "type": event.get("type"),
            }
        changed = True
    if changed or not state_file.exists():
        atomic_write_json(state_file, state)
    return state


def _self_check() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        journal = root / "rail-events.jsonl"
        state = root / ".rail_state.json"
        append_event(journal, {"type": "claim_acquired", "task_id": "A", "controller_epoch": 7})
        append_event(journal, {"type": "claim_renewed", "task_id": "A"})
        with journal.open("ab") as stream:
            stream.write(b'{"cursor":3')
        third = append_event(journal, {"type": "claim_lost", "task_id": "A"})
        state.write_text("{", encoding="utf-8")
        projected = load_projection(journal, state)
        assert third["cursor"] == 3
        assert projected["_meta"]["cursor"] == 3
        assert projected["_meta"]["controller_epoch"] == 7
        assert projected["A"]["last_event"]["type"] == "claim_lost"
        assert json.loads(state.read_text(encoding="utf-8"))["_meta"]["cursor"] == 3
        assert not list(root.glob(".*.tmp"))
    print("RAIL_DURABILITY_OK cursor=3 truncated_tail=recovered atomic_state=ok")


if __name__ == "__main__":
    _self_check()
