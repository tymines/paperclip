"""
Phase 4 activation — Python gate scenarios (gate 4: controller-restart replay
vs projection agreement) + durability/intent tests.

Platform invocation (v4 fix — module execution avoids sys.path/import issues;
`python3` is NOT a Windows command name):
  macOS / Linux:  python3 -m scripts.test_rail_phase4
  Windows:        py -3 -m scripts.test_rail_phase4

On Windows the `python3` executable does not exist by default; the `py` launcher
(`py -3`) is the canonical Windows Python 3 invocation. Module execution
(`-m scripts.test_rail_phase4`) is used instead of direct script invocation
(`scripts/test_rail_phase4.py`) because it correctly resolves the `scripts`
package namespace, ensuring sibling imports (rail_controller, watchdog,
rail_durability) resolve cleanly. NO package.json changes — this is a
documented platform split, not a shared-script edit.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))

import rail_controller as controller
import watchdog
from rail_durability import append_event, atomic_write_json, load_projection


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

    def test_claim_lost_clears_projected_ownership(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            journal = root / "rail-events.jsonl"
            state_file = root / ".rail_state.json"
            append_event(journal, {
                "type": "claim_acquired", "task_id": "T-1", "controller_epoch": 2,
                "checkout_run_id": "run-1", "execution_run_id": "run-1",
                "lease_expires_at": "2026-07-17T07:00:00+00:00",
            })
            append_event(journal, {
                "type": "claim_lost", "task_id": "T-1", "controller_epoch": 2,
                "checkout_run_id": "run-1", "execution_run_id": "run-1",
            })

            state = load_projection(journal, state_file)

            self.assertEqual(state["T-1"]["state"], "claim_lost")
            self.assertIsNone(state["T-1"]["checkout_run_id"])
            self.assertIsNone(state["T-1"]["execution_run_id"])
            self.assertIsNone(state["T-1"]["lease_expires_at"])

    def test_projection_version_rebuild_preserves_unrelated_task_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            journal = root / "rail-events.jsonl"
            state_file = root / ".rail_state.json"
            append_event(journal, {
                "type": "claim_acquired", "task_id": "T-1", "controller_epoch": 2,
                "checkout_run_id": "run-2", "execution_run_id": "run-2",
                "lease_expires_at": "2026-07-17T07:15:00+00:00",
            })
            state_file.write_text(json.dumps({
                "_meta": {"projection_version": 1, "cursor": 99},
                "T-1": {
                    "state": "stale", "checkout_run_id": "run-1",
                    "execution_run_id": "run-1", "lease_expires_at": "stale",
                    "stall_count": 3, "rework_count": 1,
                },
            }), encoding="utf-8")

            state = load_projection(journal, state_file)

            self.assertEqual(state["T-1"]["stall_count"], 3)
            self.assertEqual(state["T-1"]["rework_count"], 1)
            self.assertEqual(state["T-1"]["state"], "run_backed_claim")
            self.assertEqual(state["T-1"]["checkout_run_id"], "run-2")
            self.assertEqual(state["T-1"]["execution_run_id"], "run-2")

    def test_atomic_write_failure_keeps_last_good_projection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state_file = root / ".rail_state.json"
            expected = {"_meta": {"projection_version": 2, "cursor": 7}}
            state_file.write_text(json.dumps(expected), encoding="utf-8")

            with mock.patch("rail_durability.os.replace", side_effect=OSError("replace failed")):
                with self.assertRaisesRegex(OSError, "replace failed"):
                    atomic_write_json(state_file, {"_meta": {"projection_version": 2, "cursor": 8}})

            self.assertEqual(json.loads(state_file.read_text(encoding="utf-8")), expected)
            self.assertEqual(list(root.glob(".*.tmp")), [])

    def test_restart_rebuilds_when_persisted_cursor_is_ahead_of_journal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            journal = root / "rail-events.jsonl"
            state_file = root / ".rail_state.json"
            append_event(journal, {
                "type": "claim_acquired", "task_id": "T-1", "controller_epoch": 3,
                "checkout_run_id": "run-3", "execution_run_id": "run-3",
                "lease_expires_at": "2026-07-17T07:15:00+00:00",
            })
            state_file.write_text(json.dumps({
                "_meta": {"projection_version": 2, "cursor": 99, "controller_epoch": 99},
                "T-1": {
                    "state": "stale", "checkout_run_id": "stale-run",
                    "execution_run_id": "stale-run", "lease_expires_at": "stale",
                    "stall_count": 2,
                },
            }), encoding="utf-8")

            state = load_projection(journal, state_file)

            self.assertEqual(state["_meta"]["cursor"], 1)
            self.assertEqual(state["_meta"]["controller_epoch"], 3)
            self.assertEqual(state["T-1"]["state"], "run_backed_claim")
            self.assertEqual(state["T-1"]["checkout_run_id"], "run-3")
            self.assertEqual(state["T-1"]["execution_run_id"], "run-3")
            self.assertEqual(state["T-1"]["stall_count"], 2)

            state_file.write_text(json.dumps({
                "_meta": "corrupt",
                "T-1": {"state": "stale", "stall_count": 3},
            }), encoding="utf-8")
            rebuilt = load_projection(journal, state_file)
            self.assertEqual(rebuilt["_meta"]["cursor"], 1)
            self.assertEqual(rebuilt["T-1"]["stall_count"], 3)

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

    def test_controller_epoch_advances_past_durable_db_epoch_and_registers_it(self):
        executed = []

        class Cursor:
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return False
            def execute(self, query, params=None):
                executed.append((query, params))
            def fetchone(self):
                return (9,)

        class Connection:
            def cursor(self):
                return Cursor()

        state = {"_meta": {"controller_epoch": 4}}
        with mock.patch.object(controller, "load_state", return_value=state), \
             mock.patch.object(controller, "save_state") as save_state:
            epoch = controller.next_controller_epoch(Connection())

        self.assertEqual(epoch, 10)
        self.assertEqual(state["_meta"]["controller_epoch"], 10)
        save_state.assert_called_once_with(state)
        self.assertIn("rail.controller_epoch", executed[0][0])
        self.assertIn("INSERT INTO activity_log", executed[1][0])
        self.assertEqual(executed[1][1], (controller.CID, controller.CID, 10))

    def test_expired_lease_reclaimer_fences_run_ids_and_defers_recent_heartbeats(self):
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

        sql = executed[0]
        self.assertIn("SELECT i.id, i.checkout_run_id, i.execution_run_id", sql)
        self.assertIn("LEFT JOIN heartbeat_runs hr ON hr.id = i.execution_run_id", sql)
        self.assertIn("coalesce(hr.last_output_at, hr.updated_at) > now() - interval '15 minutes'", sql)
        self.assertIn("THEN now() + interval '15 minutes'", sql)
        self.assertIn("AND i.execution_run_id = e.execution_run_id", sql)
        self.assertIn("WHERE NOT heartbeat_recent", sql)
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
        controller.CONTROLLER_EPOCH = 7
        issue = {"id": "T-1", "identifier": "RAIL-1", "title": "Lease", "status": "todo"}
        agent = {"id": "agent-1", "urlKey": "zeus", "status": "idle"}
        claimed = {
            "id": "T-1", "status": "in_progress", "assigneeAgentId": "agent-1",
            "checkoutRunId": "run-1", "executionRunId": "run-1",
            "leaseExpiresAt": "2099-01-01T00:00:00+00:00",
        }
        with mock.patch.object(controller, "api", side_effect=[issue, [agent], claimed]) as api_call, \
             mock.patch.object(controller, "emit_event") as emit_event:
            result = controller.claim_task({
                "enforcement": "on", "eligible_issue_ids": ["T-1"], "seats": ["zeus"],
            })
        self.assertEqual(result, claimed)
        self.assertEqual(api_call.call_args_list[2].args[2]["controllerEpoch"], 7)
        emit_event.assert_called_once_with(
            "claim_acquired", "T-1", identifier="RAIL-1", title="Lease",
            assignee_agent_id="agent-1", checkout_run_id="run-1", execution_run_id="run-1",
            lease_expires_at="2099-01-01T00:00:00+00:00",
        )

    def test_allowlisted_storage_issue_is_never_claimed(self):
        controller.CONTROLLER_EPOCH = 7
        issue = {"id": "T-1", "identifier": "RAIL-1", "title": "Stored", "status": "storage"}
        agent = {"id": "agent-1", "urlKey": "zeus", "status": "idle"}
        with mock.patch.object(controller, "api", side_effect=[issue, [agent]]) as api_call, \
             mock.patch.object(controller, "emit_event") as emit_event:
            result = controller.claim_task({
                "enforcement": "on", "eligible_issue_ids": ["T-1"], "seats": ["zeus"],
            })

        self.assertIsNone(result)
        self.assertNotIn("POST", [call.args[0] for call in api_call.call_args_list])
        emit_event.assert_not_called()

    def test_gate4_controller_restart_replay_vs_projection_agreement(self):
        # Gate 4: on controller restart, the durable projection replay and the
        # controller's epoch reconcile AGREE on the fence. The projection fences
        # stale-epoch events (ignored_stale_epoch_events) and lands on the durable
        # max epoch; a controller restart inherits that same epoch via load_state,
        # advances past it via next_controller_epoch, and a stale controller
        # (below the max) is refused by controller.api() — both sides fence the
        # SAME stale epoch consistently. Existing tests cover projection-fencing,
        # epoch-advance, and stale-api-refusal SEPARATELY; this test asserts the
        # full restart sequence agrees end-to-end.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            journal = root / "rail-events.jsonl"
            state_file = root / ".rail_state.json"
            # Journal: epoch-2 acquire + renew, then a stale epoch-1 claim_lost.
            append_event(journal, {
                "type": "claim_acquired", "task_id": "T-1", "controller_epoch": 2,
                "checkout_run_id": "run-1", "execution_run_id": "run-1",
                "lease_expires_at": "2026-07-17T07:00:00+00:00",
            })
            append_event(journal, {
                "type": "claim_renewed", "task_id": "T-1", "controller_epoch": 2,
                "checkout_run_id": "run-1", "execution_run_id": "run-1",
                "lease_expires_at": "2026-07-17T07:05:00+00:00",
            })
            append_event(journal, {
                "type": "claim_lost", "task_id": "T-1", "controller_epoch": 1,
            })

            # --- PROJECTION side: replay fences the stale-epoch event. ---
            state_file.write_text("{", encoding="utf-8")
            state = load_projection(journal, state_file)
            self.assertEqual(state["_meta"]["cursor"], 3)
            self.assertEqual(state["_meta"]["controller_epoch"], 2)
            self.assertEqual(state["_meta"]["ignored_stale_epoch_events"], 1)
            self.assertEqual(state["T-1"]["state"], "run_backed_claim")
            self.assertEqual(state["T-1"]["last_event"]["type"], "claim_renewed")

            # --- CONTROLLER side: restart inherits the projected epoch, then advances. ---
            class RestartCursor:
                def __init__(self):
                    self.queries = []
                def __enter__(self):
                    return self
                def __exit__(self, *_):
                    return False
                def execute(self, query, params=None):
                    self.queries.append((str(query), params))
                def fetchone(self):
                    return (2,)  # durable DB max epoch == projection's max (2)
            class RestartConnection:
                def cursor(self):
                    return RestartCursor()
            with mock.patch.object(controller, "load_state", return_value=state), \
                 mock.patch.object(controller, "save_state") as save_state:
                next_epoch = controller.next_controller_epoch(RestartConnection())
            # Controller advances past BOTH the durable DB max (2) and the
            # projected state epoch (2) → next epoch is 3.
            self.assertEqual(next_epoch, 3)
            self.assertEqual(state["_meta"]["controller_epoch"], 3)
            save_state.assert_called_once_with(state)

            # --- AGREEMENT: a stale controller (epoch 1, below the durable max 2)
            # is refused by controller.api() — the SAME stale epoch the projection
            # fenced. Both sides agree: epoch 1 is stale, epoch 2 was current. ---
            controller.CONTROLLER_EPOCH = 1
            try:
                with mock.patch.object(controller, "load_state", return_value=state), \
                     mock.patch.object(controller.urllib.request, "urlopen") as urlopen:
                    result = controller.api("POST", "/api/issues/T-1/comments", {"body": "stale"})
                self.assertIsNone(result)
                urlopen.assert_not_called()
            finally:
                controller.CONTROLLER_EPOCH = None


class Phase4IntentTests(unittest.TestCase):
    def test_agent_identity_matching_is_case_insensitive(self):
        from rail_intent import compare_intent
        manifest = {"revision": "1", "updated": "2026-07-17", "agents": [{"name": "Zeus"}]}
        live = {"agents": [{"name": "zeus"}]}
        self.assertFalse(any(row["field"] == "name" for row in compare_intent(manifest, live)))

    def test_accept_live_proposal_includes_roster_additions_and_removals(self):
        from rail_intent import accept_live_as_intent
        manifest = {
            "revision": "7", "updated": "2026-07-17",
            "agents": [{"name": "Zeus", "model": "gpt-5"}, {"name": "Retired", "model": "old"}],
        }
        original = json.loads(json.dumps(manifest))
        live = {"agents": [{"name": "Zeus", "model": "gpt-5"}, {"name": "New", "model": "kimi"}]}

        proposal = accept_live_as_intent(manifest, live)

        self.assertEqual(proposal["expected_revision"], "7")
        self.assertIn(
            {"agent": "New", "field": "name", "declared": None, "live": "New"},
            proposal["changes"],
        )
        self.assertIn(
            {"agent": "Retired", "field": "name", "declared": "Retired", "live": None},
            proposal["changes"],
        )
        self.assertEqual(manifest, original)

    def test_intent_drift_alerts_immediately_then_hourly_and_daily(self):
        manifest = {"revision": "7", "updated": "2026-07-17", "agents": [{"name": "Zeus"}]}
        payload = {"agents": [{"name": "Zeus"}]}
        drift = {"agent": "Zeus", "field": "model", "declared": "gpt-5", "live": "kimi"}
        persisted = {}

        def load_state():
            return json.loads(json.dumps(persisted))

        def save_state(value):
            persisted.clear()
            persisted.update(json.loads(json.dumps(value)))

        with mock.patch.object(controller, "load_manifest", return_value=manifest), \
             mock.patch.object(controller, "api", return_value=payload), \
             mock.patch.object(controller, "compare_intent", return_value=[drift]) as compare, \
             mock.patch.object(controller, "load_state", side_effect=load_state), \
             mock.patch.object(controller, "save_state", side_effect=save_state), \
             mock.patch.object(controller, "now_ts") as now, \
             mock.patch.object(controller, "emit_event") as emit_event, \
             mock.patch.object(controller, "_log"):
            for clock in (100, 3699, 3700, 90099, 90100):
                now.return_value = clock
                controller.report_intent_drift()

            self.assertEqual(
                [call.kwargs["cadence"] for call in emit_event.call_args_list],
                ["immediate", "one_hour", "daily"],
            )

            compare.return_value = []
            now.return_value = 90101
            controller.report_intent_drift()

        self.assertEqual(persisted["_meta"]["intent_drift"], {})

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
