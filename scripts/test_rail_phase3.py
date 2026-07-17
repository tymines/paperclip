"""Phase 3 checks: external journal, no PG mirror, verified-5432 fallback."""
import json
import os
import pathlib
import sys
import tempfile
import types

with tempfile.TemporaryDirectory() as home:
    os.environ["PAPERCLIP_HOME"] = home
    os.environ.pop("RAIL_EVENTS_LOG", None)
    sys.path.insert(0, str(pathlib.Path(__file__).parent))
    import rail_controller as rc

    expected = pathlib.Path(home) / "rail" / "rail-events.jsonl"
    assert rc.EVENTS_LOG == expected
    rc.emit_event("phase3_check", "test-task", ok=True)
    rows = expected.read_text().splitlines()
    assert len(rows) == 1
    assert json.loads(rows[0])["type"] == "phase3_check"

    source = pathlib.Path(rc.__file__).read_text()
    assert "54329" not in source
    assert "INSERT INTO rail_events" not in source
    assert "_write_rail_event_db" not in source

    class Cursor:
        def __init__(self, port):
            self.port = port
            self.queries = []
            self.description = [("id",), ("identifier",)]

        def execute(self, query, params=None):
            self.queries.append((query, params))

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def fetchone(self):
            return (self.port,)

        def fetchall(self):
            return [("task-id", "AUG-TEST")]

    class Connection:
        def __init__(self, port):
            self.cursor_value = Cursor(port)
            self.closed = False

        def cursor(self):
            return self.cursor_value

        def close(self):
            self.closed = True

    calls = []
    good = Connection("5432")

    def connect_good(**kwargs):
        calls.append(kwargs)
        return good

    sys.modules["psycopg2"] = types.SimpleNamespace(connect=connect_good)
    result = rc.query_board_direct(["task-id"])
    assert result == [{"id": "task-id", "identifier": "AUG-TEST"}]
    assert calls == [{
        "host": "127.0.0.1",
        "port": 5432,
        "user": "paperclip",
        "dbname": "paperclip",
        "connect_timeout": 5,
    }]
    assert good.cursor_value.queries[0][0] == "SHOW port"

    wrong = Connection("54329")
    sys.modules["psycopg2"] = types.SimpleNamespace(connect=lambda **_: wrong)
    assert rc.query_board_direct(["task-id"]) == []
    assert [q[0] for q in wrong.cursor_value.queries] == ["SHOW port"]

print("PHASE3_PYTHON_CHECKS_OK")
