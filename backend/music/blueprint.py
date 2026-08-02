"""Flask Blueprint adapter for :mod:`backend.music`.

Importing this module does not import Command Center's monolithic ``app.py``.
Register a :class:`MusicService` as ``app.extensions['cc_music']`` before use.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
import hmac
import ipaddress
from pathlib import Path
from typing import TYPE_CHECKING, Any

try:
    from flask import Blueprint, Response, abort, current_app, jsonify, request, session
except ImportError as exc:  # a clear error only when Flask integration is requested
    raise RuntimeError("Flask is required to create the music Blueprint") from exc

from .ranges import parse_range_header
from .library import CachedArtwork
from .service import MusicService

if TYPE_CHECKING:
    from flask import Request


MutationAuthorizer = Callable[["Request"], bool]
CsrfValidator = Callable[["Request"], bool]
CHUNK_SIZE = 128 * 1024


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


def create_music_blueprint(
    service: MusicService | None = None,
    *,
    authorize_mutation: MutationAuthorizer | None = None,
    validate_csrf: CsrfValidator | None = None,
    url_prefix: str = "/api/music",
) -> Blueprint:
    """Create routes without importing or mutating the host Flask app.

    ``authorize_mutation`` can grant a signed-in administrator access from a
    non-loopback address.  For backwards compatibility the parameter keeps
    its original name, but it protects both library reads and mutations.
    Local direct peers are always allowed.
    """

    blueprint = Blueprint("cc_music", __name__, url_prefix=url_prefix)

    def get_service() -> MusicService:
        result = service or current_app.extensions.get("cc_music")
        if not isinstance(result, MusicService):
            raise RuntimeError("register MusicService as app.extensions['cc_music']")
        return result

    def can_access() -> bool:
        if is_local_request(request):
            return True
        if authorize_mutation is None:
            return False
        try:
            return bool(authorize_mutation(request))
        except Exception:
            current_app.logger.exception("music mutation authorizer failed")
            return False

    def require_access() -> None:
        if not can_access():
            abort(403)

    def csrf_is_valid() -> bool:
        if validate_csrf is not None:
            try:
                return bool(validate_csrf(request))
            except Exception:
                current_app.logger.exception("music CSRF validator failed")
                return False
        supplied = request.headers.get("X-CSRF-Token", "")
        expected = str(session.get("csrf_token") or "")
        return bool(supplied and expected and hmac.compare_digest(supplied, expected))

    def require_csrf() -> None:
        if not csrf_is_valid():
            abort(403)

    @blueprint.get("/settings")
    def get_settings() -> Response:
        payload = get_service().settings_payload()
        payload["editable"] = can_access()
        if not payload["editable"]:
            payload["music_folder"] = ""
            payload["folder_name"] = ""
        return jsonify(payload)

    @blueprint.route("/settings", methods=["POST", "PUT"])
    def put_settings() -> tuple[Response, int] | Response:
        require_access()
        require_csrf()
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "JSON object required"}), 400
        folder = payload.get("music_folder", payload.get("folder", ""))
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
    def get_library() -> Response:
        require_access()
        query = request.args.get("q", "")[:200]
        return jsonify(get_service().catalog(query))

    @blueprint.post("/scan")
    @blueprint.post("/refresh")
    def start_scan() -> tuple[Response, int]:
        require_access()
        require_csrf()
        try:
            status = get_service().start_scan()
        except (OSError, ValueError) as exc:
            return jsonify({"error": str(exc)}), 400
        return jsonify(status.public_dict()), 202

    @blueprint.get("/scan")
    def get_scan() -> Response:
        require_access()
        return jsonify(get_service().library.status().public_dict())

    @blueprint.route("/audio/<track_id>", methods=["GET", "HEAD"])
    def get_audio(track_id: str) -> Response:
        require_access()
        track = get_service().track(track_id)
        if track is None:
            abort(404)
        try:
            file_size = track.path.stat().st_size
            selected = parse_range_header(request.headers.get("Range"), file_size)
        except (OSError, ValueError):
            response = Response(status=416)
            response.headers["Content-Range"] = f"bytes */{track.byte_size}"
            response.headers["Accept-Ranges"] = "bytes"
            response.headers["X-Content-Type-Options"] = "nosniff"
            return response
        response = Response(
            None if request.method == "HEAD" else _read_slice(track.path, selected.start, selected.length),
            status=206 if selected.partial else 200,
            mimetype=track.mime_type,
            direct_passthrough=request.method != "HEAD",
        )
        response.headers["Accept-Ranges"] = "bytes"
        response.headers["Content-Length"] = str(selected.length)
        response.headers["Cache-Control"] = "private, no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        if selected.partial:
            response.headers["Content-Range"] = f"bytes {selected.start}-{selected.end}/{selected.total}"
        return response

    @blueprint.get("/art/<track_id>")
    def get_art(track_id: str) -> Response:
        require_access()
        artwork = get_service().library.artwork_for(track_id)
        if artwork is None:
            abort(404)
        if isinstance(artwork, CachedArtwork):
            try:
                data = artwork.path.read_bytes()
            except OSError:
                abort(404)
            etag = artwork.content_hash
        else:
            data = artwork.data
            import hashlib

            etag = hashlib.sha256(data).hexdigest()
        if request.if_none_match.contains(etag):
            response = Response(status=304)
            response.set_etag(etag)
            response.headers["Cache-Control"] = "private, max-age=3600"
            response.headers["X-Content-Type-Options"] = "nosniff"
            return response
        response = Response(data, mimetype=artwork.mime)
        response.set_etag(etag)
        response.headers["Cache-Control"] = "private, max-age=3600"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @blueprint.get("/stats")
    def get_stats() -> tuple[Response, int] | Response:
        require_access()
        value = request.args.get("days", "30").strip().lower()
        try:
            days = None if value in {"", "all"} else int(value)
            return jsonify(get_service().stats_summary(days))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

    @blueprint.post("/stats")
    def post_stats() -> tuple[Response, int] | Response:
        require_access()
        require_csrf()
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "JSON object required"}), 400
        try:
            return jsonify(get_service().record_stats(payload))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except LookupError as exc:
            return jsonify({"error": str(exc)}), 404

    return blueprint
