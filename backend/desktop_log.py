"""Encrypted desktop log using Windows DPAPI (falls back to Fernet on other OS).

This module creates and appends JSON entries to an encrypted file on the user's
Desktop. On Windows it uses DPAPI so only the current user can decrypt it.
"""
import os
import json
import sys
from datetime import datetime

LOG_FILENAME = 'AGENT_LOG.enc'


def _desktop_path():
    home = os.path.expanduser('~')
    desktop = os.path.join(home, 'Desktop')
    return os.path.join(desktop, LOG_FILENAME)


if os.name == 'nt':
    import ctypes
    from ctypes import wintypes

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_char))]

    def _protect(data: bytes) -> bytes:
        blob_in = DATA_BLOB()
        blob_in.cbData = len(data)
        blob_in.pbData = ctypes.cast(ctypes.create_string_buffer(data), ctypes.POINTER(ctypes.c_char))
        blob_out = DATA_BLOB()
        if crypt32.CryptProtectData(ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)) == 0:
            raise ctypes.WinError()
        pointer = ctypes.cast(blob_out.pbData, ctypes.POINTER(ctypes.c_ubyte * blob_out.cbData))
        encrypted = bytes(pointer.contents)
        kernel32.LocalFree(blob_out.pbData)
        return encrypted

    def _unprotect(token: bytes) -> bytes:
        blob_in = DATA_BLOB()
        blob_in.cbData = len(token)
        blob_in.pbData = ctypes.cast(ctypes.create_string_buffer(token), ctypes.POINTER(ctypes.c_char))
        blob_out = DATA_BLOB()
        if crypt32.CryptUnprotectData(ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)) == 0:
            raise ctypes.WinError()
        pointer = ctypes.cast(blob_out.pbData, ctypes.POINTER(ctypes.c_ubyte * blob_out.cbData))
        data = bytes(pointer.contents)
        kernel32.LocalFree(blob_out.pbData)
        return data

else:
    from cryptography.fernet import Fernet
    import os

    def _get_key():
        key = os.environ.get('CRED_KEY')
        if not key:
            raise RuntimeError('CRED_KEY env var not set for encrypted log')
        return key.encode()

    def _protect(data: bytes) -> bytes:
        f = Fernet(_get_key())
        return f.encrypt(data)

    def _unprotect(token: bytes) -> bytes:
        f = Fernet(_get_key())
        return f.decrypt(token)


def _read_entries() -> list:
    path = _desktop_path()
    if not os.path.exists(path):
        return []
    with open(path, 'rb') as fh:
        token = fh.read()
    try:
        data = _unprotect(token)
        return json.loads(data.decode('utf-8'))
    except Exception:
        return []


def read_entries() -> list:
    return _read_entries()


def _write_entries(entries: list):
    path = _desktop_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = json.dumps(entries, indent=2).encode('utf-8')
    token = _protect(payload)
    with open(path, 'wb') as fh:
        fh.write(token)


def append_entry(entry: dict):
    entries = _read_entries()
    entries.append(entry)
    _write_entries(entries)


def init_and_append_initial():
    entry = {
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'actor': 'assistant',
        'action': 'created_encrypted_desktop_log',
        'notes': 'Initial encrypted log created by assistant. No secrets stored.'
    }
    append_entry(entry)
    return _desktop_path()


if __name__ == '__main__':
    p = init_and_append_initial()
    print('Wrote encrypted log to', p)
