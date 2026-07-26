import importlib.util
import os
import sqlite3
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PLUGIN_PATH = Path(__file__).with_name("__init__.py")


def load_plugin():
    spec = importlib.util.spec_from_file_location("hermes_cost_telemetry", PLUGIN_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load Hermes telemetry plugin")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class HermesCostTelemetryPluginTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.env = patch.dict(
            os.environ,
            {
                "HERMES_HOME": self.temp.name,
                "PAPERCLIP_RUN_ID": "run-123",
            },
            clear=False,
        )
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_persists_call_speed_and_ttft_idempotently(self):
        plugin = load_plugin()
        payload = {
            "session_id": "20260724_010203_aaaaaaaa",
            "turn_id": "turn-1",
            "api_request_id": "request-1",
            "model": "model-main",
            "provider": "provider-a",
            "started_at": 100.25,
            "ended_at": 102.75,
            "api_duration": 2.5,
            "ttft": 0.42,
            "usage": {
                "input_tokens": 500,
                "output_tokens": 200,
                "cache_read_tokens": 100,
                "cache_write_tokens": 20,
                "reasoning_tokens": 5,
            },
        }

        plugin.on_post_api_request(**payload)
        plugin.on_post_api_request(**{**payload, "ttft": 99, "usage": {"output_tokens": 9999}})

        db_path = Path(self.temp.name) / "cost-dashboard" / "telemetry.sqlite3"
        self.assertTrue(db_path.exists())
        self.assertEqual(stat.S_IMODE(db_path.stat().st_mode), 0o600)
        with sqlite3.connect(db_path) as db:
            rows = db.execute(
                """
                SELECT session_id, turn_id, api_request_id, paperclip_run_id,
                       model, provider, input_tokens, output_tokens,
                       cache_read_tokens, cache_write_tokens, reasoning_tokens,
                       started_at, ended_at, api_duration, ttft
                FROM api_calls
                """
            ).fetchall()

        self.assertEqual(
            rows,
            [(
                "20260724_010203_aaaaaaaa",
                "turn-1",
                "request-1",
                "run-123",
                "model-main",
                "provider-a",
                500,
                200,
                100,
                20,
                5,
                100.25,
                102.75,
                2.5,
                0.42,
            )],
        )

    def test_requires_stable_session_turn_and_request_identity(self):
        plugin = load_plugin()
        plugin.on_post_api_request(
            session_id="session-1",
            turn_id="",
            api_request_id="request-1",
            model="model",
            provider="provider",
            started_at=1,
            ended_at=2,
            api_duration=1,
            usage={},
        )

        self.assertFalse((Path(self.temp.name) / "cost-dashboard" / "telemetry.sqlite3").exists())

    def test_registers_only_supported_post_api_request_hook(self):
        plugin = load_plugin()

        class Context:
            def __init__(self):
                self.hooks = []

            def register_hook(self, name, callback):
                self.hooks.append((name, callback))

        context = Context()
        plugin.register(context)

        self.assertEqual(context.hooks, [("post_api_request", plugin.on_post_api_request)])


if __name__ == "__main__":
    unittest.main()
