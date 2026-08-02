import os
import json
import sys

CREDS_PATH = os.path.expanduser('~/.local_agent/creds.enc')


if os.name == 'nt':
    # Use Windows DPAPI via ctypes
    import ctypes
    from ctypes import wintypes

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_char))]


    def _dpapi_protect(data: bytes) -> bytes:
        blob_in = DATA_BLOB()
        blob_in.cbData = len(data)
        blob_in.pbData = ctypes.cast(ctypes.create_string_buffer(data), ctypes.POINTER(ctypes.c_char))
        blob_out = DATA_BLOB()
        if crypt32.CryptProtectData(ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)) == 0:
            raise ctypes.WinError()
        # copy out
        pointer = ctypes.cast(blob_out.pbData, ctypes.POINTER(ctypes.c_ubyte * blob_out.cbData))
        encrypted = bytes(pointer.contents)
        kernel32.LocalFree(blob_out.pbData)
        return encrypted


    def _dpapi_unprotect(token: bytes) -> bytes:
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


    def save_creds(data: dict):
        os.makedirs(os.path.dirname(CREDS_PATH), exist_ok=True)
        payload = json.dumps(data).encode('utf-8')
        token = _dpapi_protect(payload)
        with open(CREDS_PATH, 'wb') as fh:
            fh.write(token)


    def load_creds() -> dict | None:
        if not os.path.exists(CREDS_PATH):
            return None
        with open(CREDS_PATH, 'rb') as fh:
            token = fh.read()
        try:
            payload = _dpapi_unprotect(token)
            return json.loads(payload.decode('utf-8'))
        except Exception:
            return None

else:
    from cryptography.fernet import Fernet


    def _get_key() -> bytes:
        key = os.environ.get('CRED_KEY')
        if not key:
            raise RuntimeError('CRED_KEY env var not set')
        return key.encode() if isinstance(key, str) else key


    def save_creds(data: dict):
        os.makedirs(os.path.dirname(CREDS_PATH), exist_ok=True)
        key = _get_key()
        f = Fernet(key)
        payload = json.dumps(data).encode('utf-8')
        token = f.encrypt(payload)
        with open(CREDS_PATH, 'wb') as fh:
            fh.write(token)


    def load_creds() -> dict | None:
        if not os.path.exists(CREDS_PATH):
            return None
        key = _get_key()
        f = Fernet(key)
        with open(CREDS_PATH, 'rb') as fh:
            token = fh.read()
        try:
            payload = f.decrypt(token)
            return json.loads(payload.decode('utf-8'))
        except Exception:
            return None
