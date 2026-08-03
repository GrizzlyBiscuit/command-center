"""Helpers for host-specific filesystem configuration."""

import os
import shutil


def configured_path(name, legacy_default):
    """Return an environment override, or the existing install path by default."""
    configured = os.environ.get(name, '').strip()
    return os.path.expandvars(os.path.expanduser(configured or legacy_default))


def resolve_ollama_executable(legacy_default, *, environ=None, which=None, is_file=None):
    """Locate Ollama without breaking the original host-specific installation."""
    environ = os.environ if environ is None else environ
    which = shutil.which if which is None else which
    is_file = os.path.isfile if is_file is None else is_file

    configured = environ.get('OLLAMA_EXE', '').strip()
    if configured:
        return os.path.expandvars(os.path.expanduser(configured))

    discovered = which('ollama')
    if discovered:
        return discovered

    local_app_data = environ.get('LOCALAPPDATA', '').strip()
    if local_app_data:
        standard = os.path.join(
            os.path.expandvars(os.path.expanduser(local_app_data)),
            'Programs',
            'Ollama',
            'ollama.exe',
        )
        if is_file(standard):
            return standard

    return os.path.expandvars(os.path.expanduser(legacy_default))
