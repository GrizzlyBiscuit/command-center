from __future__ import annotations

from pathlib import Path
import tempfile
import time
import unittest

try:
    from flask import Flask

    FLASK_AVAILABLE = True
except ImportError:
    Flask = None  # type: ignore[assignment]
    FLASK_AVAILABLE = False

from backend.music import MusicService, init_music
from backend.music.library import MusicLibrary
from backend.music.metadata import Artwork


@unittest.skipUnless(FLASK_AVAILABLE, "Flask is an optional dependency for route tests")
class MusicBlueprintTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.music = self.root / "music"
        self.music.mkdir()
        (self.music / "song.mp3").write_bytes(b"0123456789")
        library = MusicLibrary(
            metadata_reader=lambda _path: {
                "title": "Server title",
                "artist": "Server artist",
                "album": "Server album",
            },
            artwork_reader=lambda _path: Artwork(b"shared-cover", "image/jpeg"),
            artwork_cache_dir=self.root / "data" / "music-artwork",
        )
        self.service = MusicService(self.root / "data", library=library)
        self.service.configure_folder(str(self.music), scan=False)
        self.service.library.scan_now(self.service.settings)
        self.track = self.service.library.snapshot().tracks[0]
        self.app = Flask(__name__)
        self.app.secret_key = "test-only"
        init_music(self.app, service=self.service, scan_on_start=False)
        self.client = self.app.test_client()
        with self.client.session_transaction() as session:
            session["csrf_token"] = "known-token"

    def tearDown(self) -> None:
        deadline = time.monotonic() + 3
        while self.service.library.status().running and time.monotonic() < deadline:
            time.sleep(0.01)
        self.temporary.cleanup()

    def test_settings_are_editable_locally_and_redacted_remotely(self) -> None:
        local = self.client.get("/api/music/settings")
        self.assertEqual(local.status_code, 200)
        self.assertTrue(local.json["editable"])
        self.assertEqual(local.json["music_folder"], str(self.music.resolve()))

        remote = self.client.get("/api/music/settings", environ_base={"REMOTE_ADDR": "198.51.100.4"})
        self.assertEqual(remote.status_code, 200)
        self.assertFalse(remote.json["editable"])
        self.assertEqual(remote.json["music_folder"], "")
        self.assertEqual(remote.json["folder_name"], "")
        forbidden = self.client.put(
            "/api/music/settings",
            json={"music_folder": str(self.music)},
            headers={"X-CSRF-Token": "known-token"},
            environ_base={"REMOTE_ADDR": "198.51.100.4"},
        )
        self.assertEqual(forbidden.status_code, 403)

    def test_injected_admin_authorizer_can_grant_remote_management(self) -> None:
        admin_app = Flask("music-admin-test")
        admin_app.secret_key = "test-only"
        init_music(
            admin_app,
            service=self.service,
            scan_on_start=False,
            authorize_mutation=lambda incoming: incoming.headers.get("X-Test-Admin") == "yes",
        )
        client = admin_app.test_client()
        with client.session_transaction() as session:
            session["csrf_token"] = "known-token"

        settings = client.get(
            "/api/music/settings",
            headers={"X-Test-Admin": "yes"},
            environ_base={"REMOTE_ADDR": "198.51.100.4"},
        )
        self.assertEqual(settings.status_code, 200)
        self.assertTrue(settings.json["editable"])
        self.assertEqual(settings.json["music_folder"], str(self.music.resolve()))

        response = client.put(
            "/api/music/settings",
            json={"music_folder": str(self.music), "scan": False},
            headers={"X-CSRF-Token": "known-token", "X-Test-Admin": "yes"},
            environ_base={"REMOTE_ADDR": "198.51.100.4"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["editable"])

    def test_remote_lan_peer_can_browse_stream_and_record_stats(self) -> None:
        public_urls = (
            "/api/music/library",
            "/api/music/scan",
            f"/api/music/audio/{self.track.id}",
            f"/api/music/art/{self.track.id}",
            "/api/music/stats?days=all",
        )
        for url in public_urls:
            with self.subTest(url=url):
                response = self.client.get(
                    url, environ_base={"REMOTE_ADDR": "192.168.1.25"}
                )
                self.assertEqual(response.status_code, 200)

        head = self.client.head(
            f"/api/music/audio/{self.track.id}",
            environ_base={"REMOTE_ADDR": "192.168.1.25"},
        )
        self.assertEqual(head.status_code, 200)

        partial = self.client.get(
            f"/api/music/audio/{self.track.id}",
            headers={"Range": "bytes=2-5"},
            environ_base={"REMOTE_ADDR": "192.168.1.25"},
        )
        self.assertEqual(partial.status_code, 206)
        self.assertEqual(partial.data, b"2345")
        self.assertEqual(partial.headers["Content-Range"], "bytes 2-5/10")

        stats_write = self.client.post(
            "/api/music/stats",
            json={"track_id": self.track.id, "client_event_id": "remote-event", "seconds": 1},
            headers={"X-CSRF-Token": "known-token"},
            environ_base={"REMOTE_ADDR": "192.168.1.25"},
        )
        self.assertEqual(stats_write.status_code, 200)
        summary = self.client.get(
            "/api/music/stats?days=all",
            environ_base={"REMOTE_ADDR": "192.168.1.25"},
        )
        self.assertEqual(summary.json["summary"]["seconds"], 1)

    def test_remote_management_stays_blocked(self) -> None:
        remote = {"REMOTE_ADDR": "192.168.1.25"}
        headers = {"X-CSRF-Token": "known-token"}
        settings_write = self.client.put(
            "/api/music/settings",
            json={"music_folder": str(self.music)},
            headers=headers,
            environ_base=remote,
        )
        self.assertEqual(settings_write.status_code, 403)
        for url in ("/api/music/scan", "/api/music/refresh"):
            with self.subTest(url=url):
                response = self.client.post(url, headers=headers, environ_base=remote)
                self.assertEqual(response.status_code, 403)

        missing_csrf = self.client.post(
            "/api/music/stats",
            json={"track_id": self.track.id, "client_event_id": "no-token"},
            environ_base=remote,
        )
        self.assertEqual(missing_csrf.status_code, 403)

    def test_mutating_routes_require_csrf_separately_from_local_access(self) -> None:
        response = self.client.post("/api/music/scan")
        self.assertEqual(response.status_code, 403)
        response = self.client.post(
            "/api/music/stats", json={"track_id": self.track.id, "client_event_id": "event"}
        )
        self.assertEqual(response.status_code, 403)
        response = self.client.post(
            "/api/music/refresh", headers={"X-CSRF-Token": "known-token"}
        )
        self.assertEqual(response.status_code, 202)

    def test_pc_remote_control_is_lan_open_but_renderer_is_management_only(self) -> None:
        remote_peer = {"REMOTE_ADDR": "192.168.1.25"}
        headers = {"X-CSRF-Token": "known-token"}
        status = self.client.get("/api/music/remote", environ_base=remote_peer)
        self.assertEqual(status.status_code, 200)
        self.assertFalse(status.json["renderer_online"])
        self.assertTrue(status.json["epoch"])

        missing_csrf = self.client.post(
            "/api/music/remote/command",
            json={"action": "play"},
            environ_base=remote_peer,
        )
        self.assertEqual(missing_csrf.status_code, 403)
        offline = self.client.post(
            "/api/music/remote/command",
            json={"action": "play"},
            headers=headers,
            environ_base=remote_peer,
        )
        self.assertEqual(offline.status_code, 409)

        forbidden_renderer = self.client.post(
            "/api/music/remote/renderer",
            json={
                "renderer_id": "2dd58987-dddf-42f9-bf99-e5fcfbc4f3a2",
                "ack": 0,
                "state": {},
            },
            headers={**headers, "X-Forwarded-For": "127.0.0.1"},
            environ_base=remote_peer,
        )
        self.assertEqual(forbidden_renderer.status_code, 403)

        missing_renderer_csrf = self.client.post(
            "/api/music/remote/renderer",
            json={
                "renderer_id": "2dd58987-dddf-42f9-bf99-e5fcfbc4f3a2",
                "ack": 0,
                "state": {},
            },
        )
        self.assertEqual(missing_renderer_csrf.status_code, 403)

        renderer = self.client.post(
            "/api/music/remote/renderer",
            json={
                "renderer_id": "2dd58987-dddf-42f9-bf99-e5fcfbc4f3a2",
                "ack": 0,
                "state": {"queue": [self.track.id], "index": 0},
            },
            headers=headers,
        )
        self.assertEqual(renderer.status_code, 200)
        self.assertTrue(renderer.json["renderer"])
        self.assertNotIn("queue", renderer.json["state"])

        full_status = self.client.get("/api/music/remote", environ_base=remote_peer)
        self.assertEqual(full_status.json["state"]["queue"], [self.track.id])
        delta_status = self.client.get(
            "/api/music/remote",
            query_string={
                "epoch": full_status.json["epoch"],
                "queue_revision": full_status.json["queue_revision"],
            },
            environ_base=remote_peer,
        )
        self.assertNotIn("queue", delta_status.json["state"])
        stale_status = self.client.get(
            "/api/music/remote",
            query_string={"epoch": full_status.json["epoch"], "queue_revision": -1},
            environ_base=remote_peer,
        )
        self.assertEqual(stale_status.json["state"]["queue"], [self.track.id])

        accepted = self.client.post(
            "/api/music/remote/command",
            json={"action": "play"},
            headers=headers,
            environ_base=remote_peer,
        )
        self.assertEqual(accepted.status_code, 202)
        command_id = accepted.json["command_id"]
        self.assertNotIn("queue", accepted.json["state"])
        poll = self.client.post(
            "/api/music/remote/renderer",
            json={
                "renderer_id": "2dd58987-dddf-42f9-bf99-e5fcfbc4f3a2",
                "ack": 0,
                "state": {"queue": [self.track.id], "index": 0},
            },
            headers=headers,
        )
        self.assertEqual(poll.json["commands"], [{"action": "play", "id": command_id}])

    def test_renderer_state_validation_uses_catalog_snapshot_without_resolving_files(self) -> None:
        headers = {"X-CSRF-Token": "known-token"}
        self.track.path.unlink()
        self.assertIsNone(self.service.track(self.track.id))

        response = self.client.post(
            "/api/music/remote/renderer",
            json={
                "renderer_id": "2dd58987-dddf-42f9-bf99-e5fcfbc4f3a2",
                "ack": 0,
                "state": {"queue": [self.track.id], "index": 0},
            },
            headers=headers,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.service.remote.status()["state"]["queue"], [self.track.id])

    def test_remote_control_rejects_invalid_actions_ids_and_client_media_data(self) -> None:
        headers = {"X-CSRF-Token": "known-token"}
        renderer_id = "2dd58987-dddf-42f9-bf99-e5fcfbc4f3a2"
        self.client.post(
            "/api/music/remote/renderer",
            json={"renderer_id": renderer_id, "ack": 0, "state": {}},
            headers=headers,
        )
        invalid_commands = (
            {"action": "erase"},
            {"action": "load", "queue": ["unknown-track"], "index": 0},
            {
                "action": "load",
                "queue": [self.track.id],
                "index": 0,
                "path": str(self.music / "song.mp3"),
            },
        )
        for payload in invalid_commands:
            with self.subTest(payload=payload):
                response = self.client.post(
                    "/api/music/remote/command", json=payload, headers=headers
                )
                self.assertEqual(response.status_code, 400)

        bad_renderer_state = self.client.post(
            "/api/music/remote/renderer",
            json={
                "renderer_id": renderer_id,
                "ack": 0,
                "state": {"queue": ["unknown-track"]},
            },
            headers=headers,
        )
        self.assertEqual(bad_renderer_state.status_code, 200)
        self.assertEqual(self.service.remote.status()["state"]["queue"], [])

    def test_settings_accept_post_and_put_and_honor_recursive(self) -> None:
        for method in (self.client.post, self.client.put):
            response = method(
                "/api/music/settings",
                json={"music_folder": str(self.music), "recursive": False, "scan": False},
                headers={"X-CSRF-Token": "known-token"},
            )
            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json["recursive"])

    def test_library_contract_distinguishes_configured_empty_and_scan_state(self) -> None:
        payload = self.client.get("/api/music/library?q=server").json
        self.assertTrue(payload["configured"])
        self.assertEqual(payload["state"], "complete")
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["count"], 1)
        self.assertNotIn("filename", payload["tracks"][0])
        self.assertNotIn("path", payload["tracks"][0])

    def test_audio_streams_by_id_with_range_head_and_nosniff(self) -> None:
        url = f"/api/music/audio/{self.track.id}"
        full = self.client.get(url)
        self.assertEqual(full.status_code, 200)
        self.assertEqual(full.data, b"0123456789")
        self.assertEqual(full.headers["X-Content-Type-Options"], "nosniff")
        partial = self.client.get(url, headers={"Range": "bytes=2-5"})
        self.assertEqual(partial.status_code, 206)
        self.assertEqual(partial.data, b"2345")
        self.assertEqual(partial.headers["Content-Range"], "bytes 2-5/10")
        suffix = self.client.get(url, headers={"Range": "bytes=-3"})
        self.assertEqual(suffix.status_code, 206)
        self.assertEqual(suffix.data, b"789")
        invalid = self.client.get(url, headers={"Range": "bytes=99-100"})
        self.assertEqual(invalid.status_code, 416)
        self.assertEqual(invalid.headers["Content-Range"], "bytes */10")
        head = self.client.head(url)
        self.assertEqual(head.status_code, 200)
        self.assertEqual(head.data, b"")
        self.assertEqual(self.client.get("/api/music/audio/..%2Fsong.mp3").status_code, 404)

    def test_art_has_deterministic_etag_and_conditional_get(self) -> None:
        url = f"/api/music/art/{self.track.id}"
        first = self.client.get(url)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data, b"shared-cover")
        self.assertTrue(first.headers.get("ETag"))
        second = self.client.get(url, headers={"If-None-Match": first.headers["ETag"]})
        self.assertEqual(second.status_code, 304)

    def test_stats_route_uses_catalog_metadata_and_event_idempotency(self) -> None:
        event = {
            "track_id": self.track.id,
            "client_event_id": "browser-event-1",
            "seconds": 12,
            "count_play": True,
            "title": "untrusted browser title",
        }
        first = self.client.post(
            "/api/music/stats", json=event, headers={"X-CSRF-Token": "known-token"}
        )
        duplicate = self.client.post(
            "/api/music/stats", json=event, headers={"X-CSRF-Token": "known-token"}
        )
        self.assertEqual(first.status_code, 200)
        self.assertTrue(duplicate.json["duplicate"])
        summary = self.client.get("/api/music/stats?days=all").json
        self.assertEqual(summary["summary"]["seconds"], 12)
        self.assertEqual(summary["top_tracks"][0]["title"], "Server title")


if __name__ == "__main__":
    unittest.main()
