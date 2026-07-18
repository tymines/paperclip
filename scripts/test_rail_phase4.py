import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))

import rail_controller as controller
import watchdog
from rail_durability import append_event, load_projection


class Phase4DurabilityTests(unittest.TestCase):
    def test_projection_rebuilds_claim_state_and_fences_stale_epoch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            journal = root / "rail-events.jsonl"
            state_file = root / ".rail_state.json"
            append_event(journal, {
                "type": "claim_acquired", "task_id": "T-1", "controller_epoch": 2,
                "checkout_run_id": "run-1", "execution_run_id": "run-1",
                "lease_expires_at": "2026-07-17T07:00:00+00:00",
                "worktree_path": "C:/work/T-1", "branch_name": "rail/T-1",
            })
            append_event(journal, {
                "type": "claim_renewed", "task_id": "T-1", "controller_epoch": 2,
                "checkout_run_id": "run-1", "execution_run_id": "run-1",
                "lease_expires_at": "2026-07-17T07:05:00+00:00",
            })
            append_event(journal, {
                "type": "claim_lost", "task_id": "T-1", "controller_epoch": 1,
            })
            state_file.write_text("{", encoding="utf-8")

            state = load_projection(journal, state_file)

            self.assertEqual(state["_meta"]["cursor"], 3)
            self.assertEqual(state["_meta"]["controller_epoch"], 2)
            self.assertEqual(state["T-1"]["state"], "run_backed_claim")
            self.assertEqual(state["T-1"]["lease_expires_at"], "2026-07-17T07:05:00+00:00")
            self.assertEqual(state["T-1"]["execution_run_id"], "run-1")
            self.assertEqual(state["T-1"]["worktree_path"], "C:/work/T-1")
            self.assertEqual(state["T-1"]["branch_name"], "rail/T-1")
            self.assertEqual(state["T-1"]["last_event"]["type"], "claim_renewed")
            self.assertEqual(state["_meta"]["ignored_stale_epoch_events"], 1)
            self.assertEqual(json.loads(state_file.read_text(encoding="utf-8")), state)

    def test_projection_rebuild_fences_stale_dual_run_event(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            journal = root / "rail-events.jsonl"
            state_file = root / ".rail_state.json"
            append_event(journal, {
                "type": "claim_acquired", "task_id": "T-1", "controller_epoch": 2,
                "checkout_run_id": "run-1", "execution_run_id": "run-1",
            })
            append_event(journal, {
                "type": "claim_acquired", "task_id": "T-1", "controller_epoch": 2,
                "checkout_run_id": "run-2", "execution_run_id": "run-2",
            })
            append_event(journal, {
                "type": "claim_reclaimed", "task_id": "T-1", "controller_epoch": 2,
                "checkout_run_id": "run-1", "execution_run_id": "run-1",
            })
            state_file.write_text(json.dumps({
                "_meta": {"cursor": 3}, "T-1": {"state": "ready"},
            }), encoding="utf-8")

            state = load_projection(journal, state_file)

            self.assertEqual(state["_meta"]["projection_version"], 2)
            self.assertEqual(state["_meta"]["cursor"], 3)
            self.assertEqual(state["_meta"]["ignored_stale_claim_events"], 1)
            self.assertEqual(state["T-1"]["state"], "run_backed_claim")
            self.assertEqual(state["T-1"]["checkout_run_id"], "run-2")
            self.assertEqual(state["T-1"]["execution_run_id"], "run-2")
            self.assertEqual(state["T-1"]["last_event"]["type"], "claim_acquired")

    def test_journal_rejects_invalid_claim_event_envelopes(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = Path(directory) / "rail-events.jsonl"
            with self.assertRaisesRegex(ValueError, "task_id"):
                append_event(journal, {"type": "claim_acquired"})
            with self.assertRaisesRegex(ValueError, "claim event type"):
                append_event(journal, {"type": "claim_done", "task_id": "T-1"})
            with self.assertRaisesRegex(ValueError, "cursor is journal-managed"):
                append_event(journal, {"type": "claim_acquired", "task_id": "T-1", "cursor": 99})

    def test_legacy_uncursored_prefix_is_preserved_with_virtual_cursors(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = Path(directory) / "rail-events.jsonl"
            state_file = Path(directory) / ".rail_state.json"
            journal.write_text(
                '{"type":"pipeline_start","run_id":"r-1"}\n'
                '{"type":"stage_complete","run_id":"r-1","stage":"plan"}\n',
                encoding="utf-8",
            )
            event = append_event(journal, {
                "type": "claim_acquired", "task_id": "T-1", "controller_epoch": 1,
            })
            self.assertEqual(event["cursor"], 3)
            self.assertEqual(load_projection(journal, state_file)["_meta"]["cursor"], 3)


class Phase4ControllerFenceTests(unittest.TestCase):
    def tearDown(self):
        controller.CONTROLLER_EPOCH = None

    def test_scheduler_uses_session_postgres_advisory_lock(self):
        executed = []

        class Cursor:
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return False
            def execute(self, query, params=None):
                executed.append((query, params))
            def fetchone(self):
                return (True,)

        class Connection:
            autocommit = False
            closed = False
            rolled_back = False
            def rollback(self):
                self.rolled_back = True
            def cursor(self):
                return Cursor()
            def close(self):
                self.closed = True

        connection = Connection()
        with mock.patch.object(controller, "open_db", return_value=connection):
            lock = controller.acquire_controller_lock()
        self.assertIs(lock, connection)
        self.assertTrue(connection.rolled_back)
        self.assertTrue(connection.autocommit)
        self.assertIn("pg_try_advisory_lock", executed[0][0])
        lock.close()

    def test_expired_lease_reclaimer_fences_both_run_ids(self):
        executed = []

        class Cursor:
            description = [(name,) for name in (
                "id", "identifier", "checkout_run_id", "execution_run_id", "worktree_path", "branch_name",
            )]
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return False
            def execute(self, query, params=None):
                executed.append(str(query))
            def fetchall(self):
                return [("issue-1", "RAIL-1", "checkout-1", "execution-1", "C:/work", "rail/1")]

        class Connection:
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return False
            def cursor(self):
                return Cursor()
            def close(self):
                return None

        with mock.patch.object(controller, "open_db", return_value=Connection()):
            reclaimed = controller.reclaim_expired_leases()

        self.assertIn("SELECT i.id, i.checkout_run_id, i.execution_run_id", executed[0])
        self.assertIn("AND i.execution_run_id = e.execution_run_id", executed[0])
        self.assertEqual(reclaimed[0]["execution_run_id"], "execution-1")

    def test_global_invariant_surfaces_dual_run_drift(self):
        executed = []

        class Cursor:
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return False
            def execute(self, query, params=None):
                executed.append(str(query))
            def fetchall(self):
                return []

        class Connection:
            def cursor(self):
                return Cursor()
            def close(self):
                return None

        with mock.patch.object(controller, "open_db", return_value=Connection()):
            self.assertEqual(controller.check_global_invariants(), [])

        self.assertIn("execution run missing", executed[0])
        self.assertIn("execution/checkout mismatch", executed[0])
        self.assertIn("i.execution_run_id IS NULL", executed[0])
        self.assertIn("i.execution_run_id IS DISTINCT FROM i.checkout_run_id", executed[0])

    def test_stale_controller_cannot_issue_mutating_api_request(self):
        controller.CONTROLLER_EPOCH = 4
        with mock.patch.object(controller, "load_state", return_value={"_meta": {"controller_epoch": 5}}), \
             mock.patch.object(controller.urllib.request, "urlopen") as urlopen:
            result = controller.api("POST", "/api/issues/T-1/comments", {"body": "stale"})
        self.assertIsNone(result)
        urlopen.assert_not_called()

    def test_controller_heartbeat_is_journaled(self):
        controller.CONTROLLER_EPOCH = 7
        state = {"_meta": {"controller_epoch": 7}}
        with mock.patch.object(controller, "load_state", return_value=state), \
             mock.patch.object(controller, "save_state") as save_state, \
             mock.patch.object(controller, "emit_event") as emit_event:
            controller.controller_heartbeat()
        save_state.assert_called_once()
        emit_event.assert_called_once_with("controller.heartbeat", "system")

    def test_run_backed_claim_renewal_is_projected_by_single_journal_writer(self):
        claim = {
            "state": "run_backed_claim",
            "checkout_run_id": "run-1",
            "execution_run_id": "run-1",
            "lease_expires_at": "2026-07-17T07:00:00+00:00",
        }
        issue = {
            "id": "T-1", "status": "in_progress", "checkoutRunId": "run-1",
            "executionRunId": "run-1", "leaseExpiresAt": "2026-07-17T07:05:00+00:00",
        }
        with mock.patch.object(controller, "api", return_value=issue), \
             mock.patch.object(controller, "emit_event") as emit_event:
            controller.refresh_run_backed_claim("T-1", claim)
        emit_event.assert_called_once_with(
            "claim_renewed", "T-1", checkout_run_id="run-1", execution_run_id="run-1",
            lease_expires_at="2026-07-17T07:05:00+00:00",
        )

    def test_run_backed_claim_reports_split_execution_owner_as_lost(self):
        claim = {
            "state": "run_backed_claim",
            "checkout_run_id": "run-1",
            "execution_run_id": "run-1",
            "lease_expires_at": "2026-07-17T07:00:00+00:00",
        }
        issue = {
            "status": "in_progress", "checkoutRunId": "run-1",
            "executionRunId": "run-2", "leaseExpiresAt": "2026-07-17T07:00:00+00:00",
        }
        with mock.patch.object(controller, "api", return_value=issue), \
             mock.patch.object(controller, "emit_event") as emit_event:
            controller.refresh_run_backed_claim("T-1", claim)
        emit_event.assert_called_once_with(
            "claim_lost", "T-1", checkout_run_id="run-1", execution_run_id="run-1",
            observed_status="in_progress", observed_checkout_run_id="run-1",
            observed_execution_run_id="run-2",
        )

    def test_claim_acquired_event_carries_dual_run_token(self):
        issue = {"id": "T-1", "identifier": "RAIL-1", "title": "Lease", "status": "todo"}
        agent = {"id": "agent-1", "urlKey": "zeus", "status": "idle"}
        claimed = {
            "id": "T-1", "status": "in_progress", "assigneeAgentId": "agent-1",
            "checkoutRunId": "run-1", "executionRunId": "run-1",
            "leaseExpiresAt": "2099-01-01T00:00:00+00:00",
        }
        with mock.patch.object(controller, "api", side_effect=[issue, [agent], claimed]), \
             mock.patch.object(controller, "emit_event") as emit_event:
            result = controller.claim_task({
                "enforcement": "on", "eligible_issue_ids": ["T-1"], "seats": ["zeus"],
            })
        self.assertEqual(result, claimed)
        emit_event.assert_called_once_with(
            "claim_acquired", "T-1", identifier="RAIL-1", title="Lease",
            assignee_agent_id="agent-1", checkout_run_id="run-1", execution_run_id="run-1",
            lease_expires_at="2099-01-01T00:00:00+00:00",
        )


class Phase4IntentTests(unittest.TestCase):
    def test_agent_identity_matching_is_case_insensitive(self):
        from rail_intent import compare_intent
        manifest = {"revision": "1", "updated": "2026-07-17", "agents": [{"name": "Zeus"}]}
        live = {"agents": [{"name": "zeus"}]}
        self.assertFalse(any(row["field"] == "name" for row in compare_intent(manifest, live)))

    def test_watchdog_roster_count_comes_from_fleet_intent(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / "fleet.yaml"
            manifest.write_text(
                "agents:\n  - name: Zeus\n    model: gpt-5\n  - name: Ares\n    model: kimi\n",
                encoding="utf-8",
            )
            payload = json.dumps({
                "transport": "canonical-db",
                "agents": [{"name": "Zeus"}, {"name": "Ares"}],
            }).encode()
            with mock.patch.dict(watchdog.CONFIG, {"fleet_yaml": str(manifest), "expected_roster_count": 16}), \
                 mock.patch.object(watchdog, "http_get", return_value=(200, payload)):
                self.assertEqual(watchdog.check_paperclip_fleet(), [])


if __name__ == "__main__":
    unittest.main()
