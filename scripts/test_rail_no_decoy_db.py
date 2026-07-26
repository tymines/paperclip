import pathlib
import sys
import tempfile
import types
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import rail_controller as rc


class NoDecoyDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.original_api = rc.api
        self.original_events_log = rc.EVENTS_LOG
        self.original_verbose = rc.VERBOSE
        self.original_psycopg2 = sys.modules.get("psycopg2")
        self.connections = []
        sys.modules["psycopg2"] = types.SimpleNamespace(connect=self._connect)
        rc.VERBOSE = False

    def tearDown(self):
        rc.api = self.original_api
        rc.EVENTS_LOG = self.original_events_log
        rc.VERBOSE = self.original_verbose
        if self.original_psycopg2 is None:
            sys.modules.pop("psycopg2", None)
        else:
            sys.modules["psycopg2"] = self.original_psycopg2

    def _connect(self, *args, **kwargs):
        self.connections.append((args, kwargs))
        return None

    def test_emit_event_does_not_connect_to_database(self):
        with tempfile.TemporaryDirectory() as tmp:
            rc.EVENTS_LOG = pathlib.Path(tmp) / "rail-events.jsonl"
            rc.emit_event("test", "T-1")
            self.assertTrue(rc.EVENTS_LOG.read_text(encoding="utf-8").strip())
        self.assertEqual([], self.connections)

    def test_api_failure_does_not_query_database_directly(self):
        rc.api = lambda *args, **kwargs: None
        self.assertIsNone(rc.claim_task({"enforcement": "on"}))
        self.assertEqual([], self.connections)


if __name__ == "__main__":
    unittest.main()
