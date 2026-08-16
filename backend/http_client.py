"""
Central HTTP client for hub backend.
Replaces scattered urllib/requests calls with consistent timeouts, headers,
and error handling.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger('hub.http')

DEFAULT_TIMEOUT = (5, 15)  # (connect, read) seconds
LONG_TIMEOUT = (10, 120)   # for model calls / Ollama inference


def _prepare(method: str, url: str, data: Any = None, headers: dict | None = None):
    body = None
    if data is not None:
        body = json.dumps(data).encode('utf-8')
        headers = {**(headers or {}), 'Content-Type': 'application/json'}
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    return req


def request(method: str, url: str, data: Any = None, timeout: tuple[float, float] | float = DEFAULT_TIMEOUT, headers: dict | None = None) -> Any:
    req = _prepare(method, url, data=data, headers=headers)
    if isinstance(timeout, (int, float)):
        timeout = (timeout, timeout)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            ctype = r.headers.get('Content-Type', '')
            raw = r.read()
            if 'application/json' in ctype:
                return json.loads(raw)
            return raw
    except urllib.error.HTTPError as e:
        logger.error('HTTP %s %s -> %s', method, url, e.code)
        raise
    except Exception:
        logger.exception('HTTP %s %s failed', method, url)
        raise


def get(url: str, timeout: tuple[float, float] | float = DEFAULT_TIMEOUT, headers: dict | None = None) -> Any:
    return request('GET', url, timeout=timeout, headers=headers)


def post(url: str, data: Any = None, timeout: tuple[float, float] | float = DEFAULT_TIMEOUT, headers: dict | None = None) -> Any:
    return request('POST', url, data=data, timeout=timeout, headers=headers)


def head(url: str, timeout: tuple[float, float] | float = DEFAULT_TIMEOUT, headers: dict | None = None) -> Any:
    return request('HEAD', url, timeout=timeout, headers=headers)
