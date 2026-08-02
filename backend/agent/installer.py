import os
import urllib.parse

ALLOWED_SCHEMES = {"http", "https"}
INSTALL_ROOT = os.path.abspath(os.path.join(os.path.expanduser("~"), "Desktop", "Ai", "installed_agents"))


def _is_safe_install_path(dest: str) -> bool:
    try:
        dest = os.path.abspath(dest)
    except Exception:
        return False
    if not dest.startswith(INSTALL_ROOT + os.sep) and dest != INSTALL_ROOT:
        return False
    # prevent weirdness like bare drive roots or unrelated paths
    if len(os.path.relpath(dest, INSTALL_ROOT).split(os.sep)) > 6:
        return False
    return True


def install_agent_from_url(url: str, name: str | None = None):
    if not url:
        raise ValueError("URL or path is required")

    parsed = urllib.parse.urlparse(url)
    if parsed.scheme and parsed.scheme.lower() not in ALLOWED_SCHEMES:
        raise ValueError(f"Unsupported URL scheme: {parsed.scheme}")

    if parsed.scheme:
        # remote install: derive a deterministic install dir under INSTALL_ROOT
        safe_name = (name or os.path.basename(parsed.path.strip("/").split(".")[0]) or "downloaded-agent").strip()
        dest = os.path.join(INSTALL_ROOT, safe_name)
    else:
        dest = os.path.abspath(url)

    if not _is_safe_install_path(dest):
        raise ValueError("Install path is outside the allowed agents directory.")

    os.makedirs(dest, exist_ok=True)
    return dest
