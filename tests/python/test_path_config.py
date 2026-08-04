import os
import unittest
from unittest import mock

from backend.path_config import configured_path, resolve_ollama_executable


class ConfiguredPathTests(unittest.TestCase):
    def test_environment_value_overrides_legacy_default(self):
        with mock.patch.dict(os.environ, {'CC_TEST_PATH': '~/command-center-test'}):
            self.assertEqual(
                configured_path('CC_TEST_PATH', '~/legacy-command-center'),
                os.path.expanduser('~/command-center-test'),
            )

    def test_blank_or_missing_value_uses_legacy_default(self):
        expected = os.path.join('legacy', 'command-center')
        with mock.patch.dict(os.environ, {'CC_TEST_PATH': ''}):
            self.assertEqual(configured_path('CC_TEST_PATH', expected), expected)
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(configured_path('CC_TEST_PATH', expected), expected)


class OllamaExecutableTests(unittest.TestCase):
    LEGACY = r'C:\Users\mattz\AppData\Local\Programs\Ollama\ollama.exe'

    def test_explicit_override_has_first_priority(self):
        result = resolve_ollama_executable(
            self.LEGACY,
            environ={'OLLAMA_EXE': '~/custom/ollama.exe', 'LOCALAPPDATA': 'ignored'},
            which=lambda _name: self.fail('PATH should not be checked'),
            is_file=lambda _path: self.fail('standard path should not be checked'),
        )
        self.assertEqual(result, os.path.expanduser('~/custom/ollama.exe'))

    def test_path_executable_precedes_standard_install(self):
        result = resolve_ollama_executable(
            self.LEGACY,
            environ={'LOCALAPPDATA': 'local-app-data'},
            which=lambda name: '/tools/ollama' if name == 'ollama' else None,
            is_file=lambda _path: True,
        )
        self.assertEqual(result, '/tools/ollama')

    def test_existing_current_user_install_precedes_legacy_path(self):
        expected = os.path.join('current-user', 'Programs', 'Ollama', 'ollama.exe')
        result = resolve_ollama_executable(
            self.LEGACY,
            environ={'LOCALAPPDATA': 'current-user'},
            which=lambda _name: None,
            is_file=lambda path: path == expected,
        )
        self.assertEqual(result, expected)

    def test_legacy_path_remains_the_final_fallback(self):
        result = resolve_ollama_executable(
            self.LEGACY,
            environ={},
            which=lambda _name: None,
            is_file=lambda _path: False,
        )
        self.assertEqual(result, self.LEGACY)


if __name__ == '__main__':
    unittest.main()
