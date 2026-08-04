"""Flask Blueprint adapter for :mod:`backend.video`."""

from __future__ import annotations

from collections.abc import Callable, Iterator
import hmac
import ipaddress
from pathlib import Path
from typing import TYPE_CHECKING, Any

try:
    from flask import Blueprint, Response, abort, current_app, jsonify, request, session
except ImportError as exc:
    raise RuntimeError("Flask is required to create the video Blueprint") from exc

from .ranges import parse_range_header
from .remote import CommandQueueFull, InvalidRemotePayload, RendererBusy, RendererOffline
from .service import VideoService

if TYPE_CHECKING:
    from flask import Request


ManagementAuthorizer = Callable[["Request"], bool]
CsrfValidator = Callable[["Request"], bool]
CHUNK_SIZE = 256 * 1024
MAX_JSON_PAYLOAD_BYTES = 256 * 1024


def is_local_request(request_object: "Request") -> bool:
    """Trust the direct peer only; forwarded headers are intentionally ignored."""
    value = (request_object.remote_addr or "").split("%", 1)[0]
    try:
        return ipaddress.ip_address(value).is_loopback
    except ValueError:
        return False


def _read_slice(path: Path, start: int, length: int) -> Iterator[bytes]:
    with path.open("rb") as source:
        source.seek(start)
        remaining = length
        while remaining:
            block = source.read(min(CHUNK_SIZE, remaining))
            if not block:
                break
            remaining -= len(block)
            yield block


def create_video_blueprint(
    service: VideoService | None = None,
    *,
    authorize_mutation: ManagementAuthorizer | None = None,
    validate_csrf: CsrfValidator | None = None,
    url_prefix: str = "/api/video",
) -> Blueprint:
    """Create LAN-readable video routes with local-only folder management."""

    blueprint = Blueprint("cc_video", __name__, url_prefix=url_prefix)

    def get_service() -> VideoService:
        result = service or current_app.extensions.get("cc_video")
        if not isinstance(result, VideoService):
            raise RuntimeError("register VideoService as app.extensions['cc_video']")
        return result

    def can_manage() -> bool:
        if is_local_request(request):
            return True
        if authorize_mutation is None:
            return False
        try:
            return bool(authorize_mutation(request))
        except Exception:
            current_app.logger.exception("video management authorizer failed")
            return False

    def require_management() -> None:
        if not can_manage():
            abort(403)

    def csrf_is_valid() -> bool:
        if validate_csrf is not None:
            try:
                return bool(validate_csrf(request))
            except Exception:
                current_app.logger.exception("video CSRF validator failed")
                return False
        supplied = request.headers.get("X-CSRF-Token", "")
        expected = str(session.get("csrf_token") or "")
        return bool(supplied and expected and hmac.compare_digest(supplied, expected))

    def require_csrf() -> None:
        if not csrf_is_valid():
            abort(403)

    def json_payload() -> dict[str, Any] | None:
        if request.content_length is not None and request.content_length > MAX_JSON_PAYLOAD_BYTES:
            abort(413)
        # Read at most one byte beyond the public limit. This also bounds and
        # rejects chunked bodies that do not declare Content-Length.
        request.max_content_length = MAX_JSON_PAYLOAD_BYTES + 1
        if len(request.get_data(cache=True)) > MAX_JSON_PAYLOAD_BYTES:
            abort(413)
        payload = request.get_json(silent=True)
        return payload if isinstance(payload, dict) else None

    def remote_error(exc: Exception, status: int) -> tuple[Response, int]:
        payload = get_service().remote.compact_status()
        payload.update({"error": str(exc), "renderer": False, "commands": []})
        return jsonify(payload), status

    @blueprint.get("/settings")
    def get_settings() -> Response:
        payload = get_service().settings_payload()
        payload["editable"] = can_manage()
        if not payload["editable"]:
            payload["video_folder"] = ""
            payload["folder_name"] = ""
        return jsonify(payload)

    @blueprint.route("/settings", methods=["POST", "PUT"])
    def put_settings() -> tuple[Response, int] | Response:
        require_management()
        require_csrf()
        payload = json_payload()
        if payload is None:
            return jsonify({"error": "JSON object required"}), 400
        folder = payload.get("video_folder", payload.get("folder", ""))
        try:
            result = get_service().configure_folder(
                str(folder or ""),
                recursive=payload.get("recursive", True) is not False,
                scan=payload.get("scan", True) is not False,
            )
        except (OSError, ValueError) as exc:
            return jsonify({"error": str(exc)}), 400
        result["editable"] = True
        return jsonify(result), 202 if result["scan"].get("running") else 200

    @blueprint.get("/library")
    def get_library() -> tuple[Response, int] | Response:
        query = request.args.get("q", "")[:200]
        try:
            return jsonify(get_service().catalog(query))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

    @blueprint.post("/scan")
    @blueprint.post("/refresh")
    def start_scan() -> tuple[Response, int]:
        require_management()
        require_csrf()
        try:
            status = get_service().start_scan()
        except (OSError, ValueError) as exc:
            return jsonify({"error": str(exc)}), 400
        return jsonify(status.public_dict()), 202

    @blueprint.get("/scan")
    def get_scan() -> Response:
        return jsonify(get_service().library.status().public_dict())

    @blueprint.route("/stream/<video_id>", methods=["GET", "HEAD"])
    def get_stream(video_id: str) -> Response:
        video = get_service().video(video_id)
        if video is None:
            abort(404)
        file_size = video.byte_size
        try:
            file_size = video.path.stat().st_size
            selected = parse_range_header(request.headers.get("Range"), file_size)
        except (OSError, ValueError):
            response = Response(status=416)
            response.headers["Content-Range"] = f"bytes */{file_size}"
            response.headers["Content-Length"] = "0"
            response.headers["Accept-Ranges"] = "bytes"
            response.headers["Cache-Control"] = "private, no-cache"
            response.headers["X-Content-Type-Options"] = "nosniff"
            return response
        response = Response(
            None
            if request.method == "HEAD"
            else _read_slice(video.path, selected.start, selected.length),
            status=206 if selected.partial else 200,
            mimetype=video.mime_type,
            direct_passthrough=request.method != "HEAD",
        )
        response.headers["Accept-Ranges"] = "bytes"
        response.headers["Content-Length"] = str(selected.length)
        response.headers["Cache-Control"] = "private, no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        if selected.partial:
            response.headers["Content-Range"] = (
                f"bytes {selected.start}-{selected.end}/{selected.total}"
            )
        return response

    @blueprint.get("/progress")
    def get_progress() -> tuple[Response, int] | Response:
        try:
            limit = int(request.args.get("limit", "20"))
            return jsonify(get_service().progress_payload(limit=limit))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

    @blueprint.route("/progress/<video_id>", methods=["POST", "PUT"])
    def put_progress(video_id: str) -> tuple[Response, int] | Response:
        require_csrf()
        payload = json_payload()
        if payload is None:
            return jsonify({"error": "JSON object required"}), 400
        unexpected = set(payload) - {"position", "duration", "completed"}
        if unexpected:
            return jsonify({"error": "progress contains unsupported fields"}), 400
        try:
            return jsonify(get_service().record_progress(video_id, payload))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except LookupError as exc:
            return jsonify({"error": str(exc)}), 404

    @blueprint.get("/remote")
    def get_remote_playback() -> Response:
        revision_value = request.args.get("queue_revision")
        try:
            queue_revision = int(revision_value) if revision_value is not None else None
        except ValueError:
            queue_revision = None
        return jsonify(
            get_service().remote.status(
                epoch=request.args.get("epoch"),
                queue_revision=queue_revision,
            )
        )

    @blueprint.post("/remote/command")
    def post_remote_command() -> tuple[Response, int] | Response:
        require_csrf()
        payload = json_payload()
        if payload is None:
            return jsonify({"error": "JSON object required"}), 400
        try:
            return jsonify(get_service().remote.enqueue(payload)), 202
        except RendererOffline as exc:
            return remote_error(exc, 409)
        except CommandQueueFull as exc:
            return remote_error(exc, 429)
        except InvalidRemotePayload as exc:
            return remote_error(exc, 400)

    @blueprint.post("/remote/renderer")
    def post_remote_renderer() -> tuple[Response, int] | Response:
        require_management()
        require_csrf()
        payload = json_payload()
        if payload is None:
            return jsonify({"error": "JSON object required"}), 400
        try:
            return jsonify(get_service().remote.renderer_heartbeat(payload))
        except RendererBusy as exc:
            return remote_error(exc, 409)
        except InvalidRemotePayload as exc:
            return remote_error(exc, 400)

    return blueprint
