from __future__ import annotations

import io
import json
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

from backend.video import VideoService, init_video
from backend.video.library import VideoLibrary


@unittest.skipUnless(FLASK_AVAILABLE, "Flask is an optional dependency for route tests")
class VideoBlueprintTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.videos = self.root / "videos"
        self.videos.mkdir()
        (self.videos / "Movie.mp4").write_bytes(b"0123456789")
        (self.videos / "Clip.webm").write_bytes(b"abcdefghij")
        (self.videos / "Not Supported.mkv").write_bytes(b"no")
        library = VideoLibrary(
            metadata_reader=lambda path: {"title": f"Server {path.stem}", "duration": 60}
        )
        self.service = VideoService(self.root / "data", library=library)
        self.service.configure_folder(str(self.videos), scan=False)
        self.service.library.scan_now(self.service.settings)
        self.video = next(
            video for video in self.service.library.snapshot().videos if video.format == "MP4"
        )
        self.app = Flask(__name__)
        self.app.secret_key = "test-only"
        init_video(self.app, service=self.service, scan_on_start=False)
        self.client = self.app.test_client()
        with self.client.session_transaction() as session:
            session["csrf_token"] = "known-token"

    def tearDown(self) -> None:
        deadline = time.monotonic() + 3
        while self.service.library.status().running and time.monotonic() < deadline:
            time.sleep(0.01)
        self.temporary.cleanup()

    def test_settings_are_local_only_and_forwarded_headers_are_not_trusted(self) -> None:
        local = self.client.get("/api/video/settings")
        self.assertEqual(local.status_code, 200)
        self.assertTrue(local.json["editable"])
        self.assertEqual(local.json["video_folder"], str(self.videos.resolve()))

        remote_env = {"REMOTE_ADDR": "192.168.1.25"}
        remote = self.client.get(
            "/api/video/settings",
            headers={"X-Forwarded-For": "127.0.0.1"},
            environ_base=remote_env,
        )
        self.assertFalse(remote.json["editable"])
        self.assertEqual(remote.json["video_folder"], "")
        self.assertEqual(remote.json["folder_name"], "")
        forbidden = self.client.put(
            "/api/video/settings",
            json={"video_folder": str(self.videos)},
            headers={"X-CSRF-Token": "known-token", "X-Forwarded-For": "127.0.0.1"},
            environ_base=remote_env,
        )
        self.assertEqual(forbidden.status_code, 403)

    def test_settings_accept_post_and_put_but_require_csrf(self) -> None:
        self.assertEqual(
            self.client.put(
                "/api/video/settings", json={"video_folder": str(self.videos)}
            ).status_code,
            403,
        )
        for method in (self.client.post, self.client.put):
            response = method(
                "/api/video/settings",
                json={
                    "video_folder": str(self.videos),
                    "recursive": False,
                    "scan": False,
                },
                headers={"X-CSRF-Token": "known-token"},
            )
            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json["recursive"])

    def test_library_is_lan_readable_and_exposes_only_safe_catalog_data(self) -> None:
        response = self.client.get(
            "/api/video/library?q=movie", environ_base={"REMOTE_ADDR": "192.168.1.25"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["configured"])
        self.assertEqual(response.json["state"], "complete")
        self.assertEqual(response.json["count"], 1)
        self.assertEqual(response.json["total"], 2)
        item = response.json["videos"][0]
        self.assertEqual(item["title"], "Server Movie")
        self.assertNotIn("filename", item)
        self.assertNotIn("path", item)
        self.assertEqual(item["stream_url"], f"/api/video/stream/{item['id']}")

    def test_stream_supports_full_head_suffix_and_explicit_byte_ranges(self) -> None:
        url = f"/api/video/stream/{self.video.id}"
        full = self.client.get(url, environ_base={"REMOTE_ADDR": "192.168.1.25"})
        self.assertEqual(full.status_code, 200)
        self.assertEqual(full.data, b"0123456789")
        self.assertEqual(full.mimetype, "video/mp4")
        self.assertEqual(full.headers["Accept-Ranges"], "bytes")
        self.assertEqual(full.headers["X-Content-Type-Options"], "nosniff")

        partial = self.client.get(url, headers={"Range": "bytes=2-5"})
        self.assertEqual(partial.status_code, 206)
        self.assertEqual(partial.data, b"2345")
        self.assertEqual(partial.headers["Content-Range"], "bytes 2-5/10")
        suffix = self.client.get(url, headers={"Range": "bytes=-3"})
        self.assertEqual(suffix.status_code, 206)
        self.assertEqual(suffix.data, b"789")
        head = self.client.head(url)
        self.assertEqual(head.status_code, 200)
        self.assertEqual(head.data, b"")
        invalid = self.client.get(url, headers={"Range": "bytes=99-100"})
        self.assertEqual(invalid.status_code, 416)
        self.assertEqual(invalid.headers["Content-Range"], "bytes */10")
        self.assertEqual(self.client.get("/api/video/stream/..%2FMovie.mp4").status_code, 404)

    def test_progress_persists_resume_and_recent_for_lan_clients(self) -> None:
        remote = {"REMOTE_ADDR": "192.168.1.25"}
        missing_csrf = self.client.post(
            f"/api/video/progress/{self.video.id}",
            json={"position": 12, "duration": 60},
            environ_base=remote,
        )
        self.assertEqual(missing_csrf.status_code, 403)
        saved = self.client.post(
            f"/api/video/progress/{self.video.id}",
            json={"position": 12.5, "duration": 60, "completed": False},
            headers={"X-CSRF-Token": "known-token"},
            environ_base=remote,
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json["position"], 12.5)

        progress = self.client.get("/api/video/progress", environ_base=remote)
        self.assertEqual(progress.status_code, 200)
        self.assertEqual(progress.json["items"][0]["video_id"], self.video.id)
        library = self.client.get("/api/video/library", environ_base=remote)
        self.assertEqual(library.json["recent"][0]["position"], 12.5)

        unexpected = self.client.put(
            f"/api/video/progress/{self.video.id}",
            json={"position": 1, "duration": 60, "path": str(self.video.path)},
            headers={"X-CSRF-Token": "known-token"},
        )
        self.assertEqual(unexpected.status_code, 400)
        self.assertEqual(
            self.client.get("/api/video/progress?limit=0").status_code,
            400,
        )

    def test_remote_control_is_lan_open_but_renderer_is_host_only(self) -> None:
        remote = {"REMOTE_ADDR": "192.168.1.25"}
        headers = {"X-CSRF-Token": "known-token"}
        status = self.client.get("/api/video/remote", environ_base=remote)
        self.assertEqual(status.status_code, 200)
        self.assertFalse(status.json["renderer_online"])
        self.assertEqual(
            self.client.post(
                "/api/video/remote/command",
                json={"action": "play"},
                headers=headers,
                environ_base=remote,
            ).status_code,
            409,
        )
        forbidden_renderer = self.client.post(
            "/api/video/remote/renderer",
            json={
                "renderer_id": "2dd58987-dddf-42f9-bf99-e5fcfbc4f3a2",
                "ack": 0,
                "state": {},
            },
            headers={**headers, "X-Forwarded-For": "127.0.0.1"},
            environ_base=remote,
        )
        self.assertEqual(forbidden_renderer.status_code, 403)

        renderer = self.client.post(
            "/api/video/remote/renderer",
            json={
                "renderer_id": "2dd58987-dddf-42f9-bf99-e5fcfbc4f3a2",
                "ack": 0,
                "state": {"queue": [self.video.id], "index": 0},
            },
            headers=headers,
        )
        self.assertEqual(renderer.status_code, 200)
        accepted = self.client.post(
            "/api/video/remote/command",
            json={"action": "seek", "position": 18},
            headers=headers,
            environ_base=remote,
        )
        self.assertEqual(accepted.status_code, 202)
        poll = self.client.post(
            "/api/video/remote/renderer",
            json={
                "renderer_id": "2dd58987-dddf-42f9-bf99-e5fcfbc4f3a2",
                "ack": 0,
                "state": {"queue": [self.video.id], "index": 0},
            },
            headers=headers,
        )
        self.assertEqual(
            poll.json["commands"],
            [{"action": "seek", "id": accepted.json["command_id"], "position": 18.0}],
        )

    def test_remote_load_rejects_paths_unknown_ids_and_client_urls(self) -> None:
        headers = {"X-CSRF-Token": "known-token"}
        renderer_id = "2dd58987-dddf-42f9-bf99-e5fcfbc4f3a2"
        self.client.post(
            "/api/video/remote/renderer",
            json={"renderer_id": renderer_id, "ack": 0, "state": {}},
            headers=headers,
        )
        invalid = (
            {"action": "load", "queue": [str(self.video.path)], "index": 0},
            {"action": "load", "queue": ["unknown"], "index": 0},
            {
                "action": "load",
                "queue": [self.video.id],
                "index": 0,
                "url": "https://example.test/movie.mp4",
            },
        )
        for payload in invalid:
            with self.subTest(payload=payload):
                response = self.client.post(
                    "/api/video/remote/command", json=payload, headers=headers
                )
                self.assertEqual(response.status_code, 400)

    def test_json_limit_applies_with_or_without_a_declared_length(self) -> None:
        oversized = json.dumps({"position": 1, "padding": "x" * (256 * 1024)}).encode()
        headers = {"X-CSRF-Token": "known-token", "Content-Type": "application/json"}
        declared = self.client.post(
            f"/api/video/progress/{self.video.id}",
            data=oversized,
            headers=headers,
        )
        self.assertEqual(declared.status_code, 413)

        chunked = self.client.open(
            f"/api/video/progress/{self.video.id}",
            method="POST",
            input_stream=io.BytesIO(oversized),
            content_type="application/json",
            headers={"X-CSRF-Token": "known-token"},
            environ_overrides={"CONTENT_LENGTH": "", "wsgi.input_terminated": True},
        )
        self.assertEqual(chunked.status_code, 413)


if __name__ == "__main__":
    unittest.main()
