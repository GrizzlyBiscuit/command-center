from __future__ import annotations

import unittest

from backend.music.remote import (
    CommandQueueFull,
    InvalidRemotePayload,
    MAX_QUEUE_TRACKS,
    PlaybackCoordinator,
    RendererBusy,
    RendererOffline,
)


RENDERER_A = "2dd58987-dddf-42f9-bf99-e5fcfbc4f3a2"
RENDERER_B = "c46d135f-045a-4c2a-9ce8-99e26606d455"


class FakeClock:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class PlaybackCoordinatorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clock = FakeClock()
        self.tracks = {"track-one": object(), "track-two": object()}
        self.remote = PlaybackCoordinator(
            self.tracks.keys,
            clock=self.clock,
            lease_ttl=5,
            command_ttl=15,
            epoch="test-epoch",
        )

    def heartbeat(
        self,
        *,
        renderer_id: str = RENDERER_A,
        ack: int = 0,
        state: dict[str, object] | None = None,
    ) -> dict[str, object]:
        return self.remote.renderer_heartbeat(
            {"renderer_id": renderer_id, "ack": ack, "state": state or {}}
        )

    def test_lease_expiry_clears_commands_even_when_same_uuid_returns(self) -> None:
        first = self.heartbeat(state={"queue": ["track-one"], "index": 0, "playing": True})
        self.assertTrue(first["renderer_online"])
        self.assertTrue(first["lease_claimed"])
        self.assertFalse(self.heartbeat()["lease_claimed"])
        queued = self.remote.enqueue({"action": "pause"})
        command_id = queued["command_id"]
        self.assertNotIn("queue", queued["state"])  # type: ignore[operator]

        self.clock.advance(6)
        offline = self.remote.status()
        self.assertFalse(offline["renderer_online"])
        self.assertEqual(offline["state"]["queue"], [])  # type: ignore[index]
        with self.assertRaises(RendererOffline):
            self.remote.enqueue({"action": "play"})

        reclaimed = self.heartbeat(renderer_id=RENDERER_A, ack=0)
        self.assertTrue(reclaimed["lease_claimed"])
        self.assertEqual(reclaimed["commands"], [])
        self.assertEqual(reclaimed["ack"], command_id)
        self.assertEqual(
            self.heartbeat(renderer_id=RENDERER_A, ack=command_id)["commands"], []
        )
        next_command_id = self.remote.enqueue({"action": "play"})["command_id"]
        self.assertGreater(next_command_id, command_id)  # type: ignore[operator]

    def test_live_lease_rejects_a_different_renderer(self) -> None:
        self.heartbeat()
        with self.assertRaises(RendererBusy):
            self.heartbeat(renderer_id=RENDERER_B)

    def test_commands_replay_until_monotonically_acknowledged(self) -> None:
        self.heartbeat()
        first_id = self.remote.enqueue({"action": "play"})["command_id"]
        second_id = self.remote.enqueue({"action": "pause"})["command_id"]
        first = {"action": "play", "id": first_id}
        second = {"action": "pause", "id": second_id}

        initial_poll = self.heartbeat(ack=0)
        replay = self.heartbeat(ack=0)
        self.assertEqual(initial_poll["commands"], [first, second])
        self.assertEqual(replay["commands"], [first, second])

        acknowledged = self.heartbeat(ack=first["id"])  # type: ignore[index]
        self.assertEqual(acknowledged["commands"], [second])
        self.assertEqual(self.remote.status()["ack"], first["id"])
        with self.assertRaises(InvalidRemotePayload):
            self.heartbeat(ack=0)
        self.assertEqual(self.heartbeat(ack=second["id"])["commands"], [])  # type: ignore[index]

    def test_unacknowledged_commands_expire_and_queue_is_bounded(self) -> None:
        self.assertEqual(MAX_QUEUE_TRACKS, 2000)
        remote = PlaybackCoordinator(
            self.tracks.keys,
            clock=self.clock,
            lease_ttl=30,
            command_ttl=15,
            max_pending=1,
        )
        remote.renderer_heartbeat({"renderer_id": RENDERER_A, "ack": 0, "state": {}})
        remote.enqueue({"action": "play"})
        with self.assertRaises(CommandQueueFull):
            remote.enqueue({"action": "pause"})
        self.clock.advance(16)
        polled = remote.renderer_heartbeat({"renderer_id": RENDERER_A, "ack": 0, "state": {}})
        self.assertEqual(polled["commands"], [])
        self.assertTrue(remote.enqueue({"action": "pause"})["accepted"])

    def test_load_and_state_accept_only_catalog_ids_and_safe_fields(self) -> None:
        self.heartbeat(
            state={
                "queue": ["track-one", "track-two"],
                "queue_index": 99,
                "position": -20,
                "duration": 100,
                "volume": 9,
            }
        )
        state = self.remote.status()["state"]
        self.assertEqual(state["index"], 1)  # type: ignore[index]
        self.assertEqual(state["position"], 0)  # type: ignore[index]
        self.assertEqual(state["volume"], 1)  # type: ignore[index]

        accepted = self.remote.enqueue(
            {
                "action": "load",
                "queue": ["track-two"],
                "index": 0,
                "autoplay": True,
                "position": 999999999,
                "repeat": "all",
                "shuffle": False,
            }
        )
        command = self.heartbeat(ack=0)["commands"][-1]  # type: ignore[index]
        self.assertEqual(accepted["command_id"], command["id"])  # type: ignore[index]
        self.assertEqual(command["queue"], ["track-two"])  # type: ignore[index]
        self.assertEqual(command["position"], 604800)  # type: ignore[index]
        self.assertEqual(
            self._latest_command({"action": "seek", "position": -100})["position"],
            0,
        )
        self.assertEqual(
            self._latest_command({"action": "volume", "volume": 50})["volume"],
            1,
        )

        invalid_payloads = (
            {"action": "load", "queue": ["missing"], "index": 0},
            {"action": "load", "queue": ["track-one"], "index": 0, "url": "file:///x"},
            {"action": "seek", "position": float("nan")},
            {"action": "delete"},
        )
        for payload in invalid_payloads:
            with self.subTest(payload=payload), self.assertRaises(InvalidRemotePayload):
                self.remote.enqueue(payload)

        stale = self.heartbeat(state={"queue": ["missing"], "index": 0})
        self.assertEqual(self.remote.status()["state"]["queue"], [])  # type: ignore[index]
        self.assertNotIn("queue", stale["state"])  # type: ignore[operator]
        with self.assertRaises(InvalidRemotePayload):
            self.heartbeat(state={"queue": ["track-one"], "path": "C:\\Music\\song.mp3"})

        bounded = PlaybackCoordinator(self.tracks.keys, max_queue_tracks=1)
        bounded.renderer_heartbeat({"renderer_id": RENDERER_A, "ack": 0, "state": {}})
        with self.assertRaises(InvalidRemotePayload):
            bounded.enqueue(
                {"action": "load", "queue": ["track-one", "track-two"], "index": 0}
            )

    def test_renderer_drops_stale_ids_and_remaps_the_selected_track(self) -> None:
        self.tracks["track-three"] = object()
        self.heartbeat(
            state={
                "queue": ["missing-a", "track-one", "missing-b", "track-two"],
                "index": 3,
            }
        )
        state = self.remote.status()["state"]
        self.assertEqual(state["queue"], ["track-one", "track-two"])  # type: ignore[index]
        self.assertEqual(state["index"], 1)  # type: ignore[index]

        self.heartbeat(
            state={
                "queue": ["track-one", "missing-selected", "track-two"],
                "index": 1,
            }
        )
        state = self.remote.status()["state"]
        self.assertEqual(state["queue"], ["track-one", "track-two"])  # type: ignore[index]
        self.assertEqual(state["index"], -1)  # type: ignore[index]

    def test_omitted_renderer_queue_is_retained_and_rechecked_once(self) -> None:
        calls = 0
        catalog = {"track-one", "track-two"}

        def provider() -> set[str]:
            nonlocal calls
            calls += 1
            return catalog

        remote = PlaybackCoordinator(provider, epoch="provider-epoch")
        remote.renderer_heartbeat(
            {
                "renderer_id": RENDERER_A,
                "ack": 0,
                "state": {"queue": ["track-one", "track-two"], "index": 1},
            }
        )
        self.assertEqual(calls, 1)

        calls = 0
        remote.renderer_heartbeat(
            {
                "renderer_id": RENDERER_A,
                "ack": 0,
                "state": {"index": 1, "playing": True},
            }
        )
        self.assertEqual(calls, 1)
        self.assertEqual(remote.status()["state"]["queue"], ["track-one", "track-two"])  # type: ignore[index]

        catalog.remove("track-one")
        calls = 0
        remote.renderer_heartbeat(
            {
                "renderer_id": RENDERER_A,
                "ack": 0,
                "state": {"index": 1, "playing": True},
            }
        )
        self.assertEqual(calls, 1)
        state = remote.status()["state"]
        self.assertEqual(state["queue"], ["track-two"])  # type: ignore[index]
        self.assertEqual(state["index"], 0)  # type: ignore[index]

        calls = 0
        remote.enqueue({"action": "load", "queue": ["track-two"], "index": 0})
        self.assertEqual(calls, 1)

    def test_queue_revision_and_conditional_status_delta(self) -> None:
        initial = self.remote.status()
        self.assertEqual(initial["queue_revision"], 0)
        self.assertEqual(initial["state"]["queue"], [])  # type: ignore[index]

        heartbeat = self.heartbeat(state={"queue": ["track-one"], "index": 0})
        self.assertEqual(heartbeat["queue_revision"], 1)
        self.assertNotIn("queue", heartbeat["state"])  # type: ignore[operator]
        full = self.remote.status()
        self.assertEqual(full["state"]["queue"], ["track-one"])  # type: ignore[index]

        delta = self.remote.status(epoch="test-epoch", queue_revision=1)
        self.assertNotIn("queue", delta["state"])  # type: ignore[operator]
        stale_cursor = self.remote.status(epoch="test-epoch", queue_revision=0)
        self.assertEqual(stale_cursor["state"]["queue"], ["track-one"])  # type: ignore[index]
        wrong_epoch = self.remote.status(epoch="old-epoch", queue_revision=1)
        self.assertEqual(wrong_epoch["state"]["queue"], ["track-one"])  # type: ignore[index]

        unchanged = self.heartbeat(state={"index": 0, "playing": True})
        self.assertEqual(unchanged["queue_revision"], 1)
        self.heartbeat(state={"queue": ["track-two"], "index": 0})
        self.assertEqual(self.remote.status()["queue_revision"], 2)

        self.clock.advance(6)
        expired = self.remote.status()
        self.assertEqual(expired["queue_revision"], 3)
        self.assertEqual(expired["state"]["queue"], [])  # type: ignore[index]

    def _latest_command(self, payload: dict[str, object]) -> dict[str, object]:
        accepted = self.remote.enqueue(payload)
        commands = self.heartbeat(ack=0)["commands"]
        return next(item for item in commands if item["id"] == accepted["command_id"])  # type: ignore[union-attr]


if __name__ == "__main__":
    unittest.main()
