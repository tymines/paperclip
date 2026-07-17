#!/usr/bin/env python3
"""Report fleet intent drift. Never writes or applies fleet.yaml."""
from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timezone
from pathlib import Path

FIELDS = ("model", "provider", "profile", "adapter", "auth_mode", "health")


def _value(text: str):
    value = text.split("#", 1)[0].strip().strip('"').strip("'")
    return None if value in ("", "null", "~") else value


def load_manifest(path: Path) -> dict:
    """Read the small, stable agents subset without adding a YAML dependency."""
    agents = []
    current = None
    in_agents = False
    version = updated = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        stripped = raw.strip()
        if stripped.startswith("version:") and version is None:
            version = _value(stripped.split(":", 1)[1])
        elif stripped.startswith("updated:") and updated is None:
            updated = _value(stripped.split(":", 1)[1])
        if raw == "agents:":
            in_agents = True
            continue
        if not in_agents:
            continue
        if raw.startswith("  - name:"):
            if current:
                agents.append(current)
            current = {"name": _value(raw.split(":", 1)[1])}
        elif current and raw.startswith("    ") and ":" in stripped and not stripped.startswith("#"):
            key, value = stripped.split(":", 1)
            current[key] = _value(value)
    if current:
        agents.append(current)
    return {"revision": version, "updated": updated, "agents": agents}


def _provider(model) -> str | None:
    if not model:
        return None
    value = str(model)
    if "/" in value:
        raw = value.split("/", 1)[0]
        return {"gemini": "google", "kimi-coding": "kimi"}.get(raw, raw)
    low = value.lower()
    for needle, provider in (
        ("deepseek", "deepseek"), ("kimi", "kimi"), ("gemini", "google"),
        ("gpt", "openai"), ("qwen", "qwen"), ("glm", "zai"),
    ):
        if needle in low:
            return provider
    return None


def _live_agent(agent: dict) -> dict:
    model_value = agent.get("model")
    if isinstance(model_value, dict):
        model_value = model_value.get("primary")
    model_info = agent.get("modelInfo") if isinstance(agent.get("modelInfo"), dict) else {}
    auth = agent.get("auth") if isinstance(agent.get("auth"), dict) else {}
    health = agent.get("health")
    if isinstance(health, dict):
        health = health.get("status") or health.get("ok")
    return {
        "name": agent.get("name"),
        "model": model_value,
        "provider": agent.get("provider") or model_info.get("provider") or _provider(model_value),
        "profile": agent.get("profile"),
        "adapter": agent.get("adapter") or agent.get("adapterType"),
        "auth_mode": agent.get("authMode") or agent.get("auth_mode") or auth.get("mode"),
        "health": health,
    }


def compare_intent(manifest: dict, payload: dict) -> list[dict]:
    declared = {a["name"]: a for a in manifest["agents"] if a.get("name")}
    live_rows = payload.get("agents", payload if isinstance(payload, list) else [])
    live = {a["name"]: a for a in map(_live_agent, live_rows) if a.get("name")}
    drift = []
    for name in sorted(declared.keys() | live.keys()):
        if name not in live:
            drift.append({"agent": name, "field": "name", "declared": name, "live": None})
            continue
        if name not in declared:
            drift.append({"agent": name, "field": "name", "declared": None, "live": name})
            continue
        declared_row = declared[name]
        live_row = live[name]
        declared_row = {**declared_row, "provider": declared_row.get("provider") or _provider(declared_row.get("model"))}
        for field in FIELDS:
            expected = declared_row.get(field)
            actual = live_row.get(field)
            if expected is None and actual is None:
                drift.append({"agent": name, "field": field, "declared": None, "live": "<unobservable>"})
                continue
            comparable_expected = str(expected).split("/", 1)[-1] if field == "model" and expected else expected
            comparable_actual = str(actual).split("/", 1)[-1] if field == "model" and actual else actual
            if comparable_expected != comparable_actual:
                drift.append({"agent": name, "field": field, "declared": expected, "live": actual})
    return drift


def manifest_age_days(manifest: dict, now: datetime | None = None) -> int | None:
    try:
        then = date.fromisoformat(str(manifest.get("updated")))
    except ValueError:
        return None
    return ((now or datetime.now(timezone.utc)).date() - then).days


def format_drift(manifest: dict, drift: dict) -> str:
    return (
        f"DRIFT: revision={manifest.get('revision')!r} age_days={manifest_age_days(manifest)!r} "
        f"agent={drift['agent']!r} field={drift['field']} "
        f"declared={drift['declared']!r} live={drift['live']!r}"
    )


def accept_live_as_intent(manifest: dict, payload: dict) -> dict:
    """Return a revision-pinned field proposal; never rewrite the manifest."""
    declared = {a["name"]: dict(a) for a in manifest["agents"] if a.get("name")}
    live_rows = payload.get("agents", payload if isinstance(payload, list) else [])
    changes = []
    for row in map(_live_agent, live_rows):
        if not row.get("name"):
            continue
        target = declared.setdefault(row["name"], {"name": row["name"]})
        for field in FIELDS:
            live = row.get(field)
            if live is not None and target.get(field) != live:
                changes.append({
                    "agent": row["name"], "field": field,
                    "declared": target.get(field), "live": live,
                })
    return {
        "kind": "accept-live-as-intent-proposal",
        "expected_revision": manifest.get("revision"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "changes": changes,
    }


def _self_check() -> None:
    manifest = {"revision": "2", "updated": "2026-07-09", "agents": [{"name": "Zeus", "model": "deepseek-v4-pro"}]}
    live = {"agents": [{"name": "Zeus", "model": "openai/gpt-5.6-sol", "profile": "default", "authMode": "oauth", "health": "ok"}]}
    drift = compare_intent(manifest, live)
    assert {row["field"] for row in drift} == {"model", "provider", "profile", "adapter", "auth_mode", "health"}
    proposed = accept_live_as_intent(manifest, live)
    assert proposed["expected_revision"] == "2"
    assert any(change["field"] == "model" and change["live"] == "openai/gpt-5.6-sol" for change in proposed["changes"])
    assert manifest["agents"][0]["model"] == "deepseek-v4-pro"
    print("RAIL_INTENT_OK drift=6 accept_live=proposal_only")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", nargs="?", type=Path)
    parser.add_argument("live", nargs="?", type=Path)
    parser.add_argument("--accept-live", "--accept-live-as-intent", dest="accept_live", action="store_true")
    args = parser.parse_args()
    if not args.manifest or not args.live:
        _self_check()
        return
    manifest = load_manifest(args.manifest)
    payload = json.loads(args.live.read_text(encoding="utf-8"))
    if args.accept_live:
        print(json.dumps(accept_live_as_intent(manifest, payload), indent=2))
        return
    for drift in compare_intent(manifest, payload):
        print(format_drift(manifest, drift))


if __name__ == "__main__":
    main()
