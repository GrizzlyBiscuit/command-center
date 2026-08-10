from __future__ import annotations

import sys
import unittest

if not sys.platform.startswith("win"):
    raise unittest.SkipTest("the desktop launcher is Windows-only")

from pathlib import Path
from types import SimpleNamespace
import json
import tempfile
from unittest import mock

from launcher import synth_launcher


class LauncherStartupTests(unittest.TestCase):
    def test_missing_python_dotenv_is_a_supported_legacy_configuration(self) -> None:
        original_import = __import__

        def import_without_dotenv(name, globals=None, locals=None, fromlist=(), level=0):
            if name == "dotenv":
                raise ImportError("dotenv is not installed")
            return original_import(name, globals, locals, fromlist, level)

        with mock.patch("builtins.__import__", side_effect=import_without_dotenv):
            self.assertFalse(synth_launcher._load_repo_environment(Path("X:/legacy")))

    def test_existing_hub_probe_uses_lightweight_version_endpoint(self) -> None:
        with (
            mock.patch.object(synth_launcher, "wait_for_server", return_value=True) as wait,
            mock.patch.object(synth_launcher, "log"),
        ):
            synth_launcher.start_hub()

        self.assertEqual(
            synth_launcher.HUB_READINESS_URL,
            f"{synth_launcher.HUB.rstrip('/')}/api/version",
        )
        wait.assert_called_once_with(synth_launcher.HUB_READINESS_URL, timeout=2)

    def test_enum_windows_callback_is_typed_and_retained(self) -> None:
        self.assertIsInstance(
            synth_launcher._EnumMinimizeCallback,
            synth_launcher._EnumWindowsProc,
        )

    def test_shutdown_uses_restarted_current_pid_from_ownership_record(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            script = root / "backend" / "app.py"
            script.parent.mkdir()
            script.touch()
            pid_file = root / "runtime" / "hub.pid"
            pid_file.parent.mkdir()
            record = {
                "pid": 2202,
                "create_time": 1234.5,
                "script": str(script.resolve()),
            }
            pid_file.write_text(json.dumps(record), encoding="utf-8")
            process = mock.Mock()
            process.create_time.return_value = 1234.5
            process.cmdline.return_value = ["pythonw.exe", str(script.resolve())]

            with (
                mock.patch.object(synth_launcher, "HUB_PID_FILE", pid_file),
                mock.patch.object(synth_launcher, "HUB_SCRIPT", script),
                mock.patch.object(synth_launcher, "_spawned", {"hub": 1101}),
                mock.patch.object(synth_launcher.psutil, "Process", return_value=process),
                mock.patch.object(synth_launcher, "kill_process_tree") as kill,
            ):
                self.assertTrue(synth_launcher._terminate_owned_hub())

            kill.assert_called_once_with(2202)
            self.assertFalse(pid_file.exists())

    def test_shutdown_rejects_reused_or_wrong_script_pid_records(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            script = root / "backend" / "app.py"
            script.parent.mkdir()
            script.touch()
            pid_file = root / "hub.pid"
            record = {
                "pid": 3303,
                "create_time": 100.0,
                "script": str(script.resolve()),
            }

            for create_time, cmdline in (
                (900.0, ["pythonw.exe", str(script.resolve())]),
                (100.0, ["pythonw.exe", str(root / "other.py")]),
            ):
                with self.subTest(create_time=create_time, cmdline=cmdline):
                    pid_file.write_text(json.dumps(record), encoding="utf-8")
                    process = mock.Mock()
                    process.create_time.return_value = create_time
                    process.cmdline.return_value = cmdline
                    with (
                        mock.patch.object(synth_launcher, "HUB_PID_FILE", pid_file),
                        mock.patch.object(synth_launcher, "HUB_SCRIPT", script),
                        mock.patch.object(synth_launcher, "_spawned", {"hub": 1101}),
                        mock.patch.object(synth_launcher.psutil, "Process", return_value=process),
                        mock.patch.object(synth_launcher, "kill_process_tree") as kill,
                        mock.patch.object(synth_launcher, "log"),
                    ):
                        self.assertFalse(synth_launcher._terminate_owned_hub())
                    kill.assert_not_called()
                    self.assertTrue(pid_file.exists())

    def test_failed_readiness_kills_only_validated_spawn_and_reports_log(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            script = root / "backend" / "app.py"
            script.parent.mkdir()
            script.touch()
            python = root / ".venv" / "Scripts" / "python.exe"
            python.parent.mkdir(parents=True)
            python.touch()
            runtime = root / "runtime"
            log_file = runtime / "hub.log"
            pid_file = runtime / "hub.pid"
            lifetime_file = runtime / "launcher.alive"
            instance_token = "readiness-test-token"
            popen = mock.Mock(pid=4404)
            process = mock.Mock()
            process.create_time.return_value = 500.25
            process.cmdline.return_value = [str(python), str(script.resolve())]

            def spawn_after_marker(*args, **kwargs):
                self.assertEqual(lifetime_file.read_text(encoding="utf-8"), instance_token)
                return popen

            with (
                mock.patch.object(synth_launcher, "HUB_SCRIPT", script),
                mock.patch.object(synth_launcher, "HUB_PY", python),
                mock.patch.object(synth_launcher, "RUNTIME_DIR", runtime),
                mock.patch.object(synth_launcher, "HUB_LOG_FILE", log_file),
                mock.patch.object(synth_launcher, "HUB_PID_FILE", pid_file),
                mock.patch.object(synth_launcher, "LAUNCHER_LIFETIME_FILE", lifetime_file),
                mock.patch.object(synth_launcher, "LAUNCHER_INSTANCE_TOKEN", instance_token),
                mock.patch.object(synth_launcher, "_spawned", {"hub": None}),
                mock.patch.object(synth_launcher, "wait_for_server", side_effect=[False, False]),
                mock.patch.object(
                    synth_launcher.subprocess,
                    "Popen",
                    side_effect=spawn_after_marker,
                ) as spawn,
                mock.patch.object(synth_launcher.psutil, "Process", return_value=process),
                mock.patch.object(synth_launcher, "kill_process_tree") as kill,
                mock.patch.object(synth_launcher.threading, "Thread"),
            ):
                with self.assertRaisesRegex(RuntimeError, str(log_file).replace("\\", "\\\\")):
                    synth_launcher.start_hub()

            kill.assert_called_once_with(4404)
            self.assertEqual(
                spawn.call_args.kwargs["env"]["CC_HUB_PID_FILE"],
                str(pid_file.resolve()),
            )
            self.assertEqual(
                spawn.call_args.kwargs["env"]["CC_LAUNCHER_LIFETIME_FILE"],
                str(lifetime_file.resolve()),
            )
            self.assertEqual(
                spawn.call_args.kwargs["env"]["CC_LAUNCHER_INSTANCE_TOKEN"],
                instance_token,
            )
            self.assertEqual(lifetime_file.read_text(encoding="utf-8"), instance_token)
            self.assertFalse(pid_file.exists())

    def test_record_write_failure_terminates_and_waits_exact_popen(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            script = root / "backend" / "app.py"
            script.parent.mkdir()
            script.touch()
            python = root / "python.exe"
            python.touch()
            runtime = root / "runtime"
            lifetime_file = runtime / "launcher.alive"
            popen = mock.Mock(pid=5505)

            with (
                mock.patch.object(synth_launcher, "HUB_SCRIPT", script),
                mock.patch.object(synth_launcher, "HUB_PY", python),
                mock.patch.object(synth_launcher, "RUNTIME_DIR", runtime),
                mock.patch.object(synth_launcher, "HUB_LOG_FILE", runtime / "hub.log"),
                mock.patch.object(synth_launcher, "HUB_PID_FILE", runtime / "hub.pid"),
                mock.patch.object(synth_launcher, "LAUNCHER_LIFETIME_FILE", lifetime_file),
                mock.patch.object(synth_launcher, "LAUNCHER_INSTANCE_TOKEN", "write-failure-token"),
                mock.patch.object(synth_launcher, "_spawned", {"hub": None}),
                mock.patch.object(synth_launcher, "wait_for_server", return_value=False),
                mock.patch.object(synth_launcher.subprocess, "Popen", return_value=popen),
                mock.patch.object(
                    synth_launcher,
                    "_write_hub_process_record",
                    side_effect=OSError("cannot publish ownership"),
                ),
            ):
                with self.assertRaisesRegex(OSError, "cannot publish ownership"):
                    synth_launcher.start_hub()

            popen.terminate.assert_called_once_with()
            popen.wait.assert_called_once_with(timeout=5)

    def test_main_surfaces_startup_failure_without_opening_webview(self) -> None:
        webview = SimpleNamespace(create_window=mock.Mock())
        with (
            mock.patch.object(synth_launcher, "webview", webview),
            mock.patch.object(synth_launcher, "already_running", return_value=(False, mock.Mock())),
            mock.patch.object(synth_launcher, "kill_all_relays"),
            mock.patch.object(synth_launcher, "start_hub", side_effect=OSError("startup exploded")),
            mock.patch.object(synth_launcher, "show_error") as show_error,
            mock.patch.object(synth_launcher, "shutdown"),
        ):
            with self.assertRaisesRegex(RuntimeError, "startup exploded"):
                synth_launcher.main()

        show_error.assert_called_once()
        self.assertIn("startup exploded", show_error.call_args.args[0])
        webview.create_window.assert_not_called()

    def test_lifetime_marker_removal_is_token_safe(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            marker = Path(temporary) / "launcher.alive"
            marker.write_text("another-launcher-token", encoding="utf-8")

            self.assertFalse(
                synth_launcher._remove_lifetime_marker_if_owned(
                    marker,
                    "this-launcher-token",
                )
            )
            self.assertEqual(
                marker.read_text(encoding="utf-8"),
                "another-launcher-token",
            )

            marker.write_text("this-launcher-token", encoding="utf-8")
            self.assertTrue(
                synth_launcher._remove_lifetime_marker_if_owned(
                    marker,
                    "this-launcher-token",
                )
            )
            self.assertFalse(marker.exists())

    def test_lifetime_marker_read_error_does_not_abort_cleanup(self) -> None:
        with (
            mock.patch.object(Path, "read_text", side_effect=PermissionError("locked")),
            mock.patch.object(synth_launcher, "log") as log,
        ):
            self.assertFalse(
                synth_launcher._remove_lifetime_marker_if_owned(
                    Path("X:/locked/launcher.alive"),
                    "this-launcher-token",
                )
            )

        self.assertIn("could not be removed safely", log.call_args.args[0])

    def test_shutdown_invalidates_lifetime_before_hub_termination(self) -> None:
        events = []
        with (
            mock.patch.object(synth_launcher, "_shutting_down", False),
            mock.patch.object(synth_launcher, "_spawned", {"hub": 6606}),
            mock.patch.object(
                synth_launcher,
                "_remove_lifetime_marker_if_owned",
                side_effect=lambda: events.append("marker"),
            ),
            mock.patch.object(
                synth_launcher,
                "_terminate_owned_hub",
                side_effect=lambda: events.append("hub"),
            ),
            mock.patch.object(synth_launcher, "kill_all_relays"),
            mock.patch.object(synth_launcher, "log"),
        ):
            synth_launcher.shutdown()

        self.assertEqual(events, ["marker", "hub"])


class LauncherPathTests(unittest.TestCase):
    def test_vbs_uses_the_neighbor_checkout_environment_or_shows_an_error(self) -> None:
        launcher = Path(__file__).resolve().parents[2] / "launcher" / "launch_cc.vbs"
        source = launcher.read_text(encoding="utf-8")

        self.assertIn('SiblingRepoRoot = Fso.BuildPath(Fso.GetParentFolderName(RepoRoot), "command-center")', source)
        self.assertIn('SiblingPython = Fso.BuildPath(SiblingRepoRoot, ".venv\\Scripts\\pythonw.exe")', source)
        self.assertIn('ElseIf Fso.FileExists(SiblingPython) Then', source)
        self.assertIn('MsgBox "Command Center could not find its Python environment."', source)
        self.assertNotIn('PythonExe = "pythonw.exe"', source)
        self.assertNotIn("C:\\Users\\mattz", source)

    def test_hub_script_prefers_override_then_checkout_then_legacy(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo = root / "checkout"
            repo_app = repo / "backend" / "app.py"
            repo_app.parent.mkdir(parents=True)
            repo_app.touch()
            legacy_app = root / "legacy" / "app.py"
            legacy_app.parent.mkdir()
            legacy_app.touch()
            override = root / "custom" / "app.py"

            self.assertEqual(
                synth_launcher.resolve_hub_script(
                    {"CC_HUB_SCRIPT": str(override)}, repo, legacy_app
                ),
                override,
            )
            self.assertEqual(synth_launcher.resolve_hub_script({}, repo, legacy_app), repo_app)
            repo_app.unlink()
            self.assertEqual(synth_launcher.resolve_hub_script({}, repo, legacy_app), legacy_app)

    def test_hub_python_prefers_checkout_and_retains_legacy_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo = root / "checkout"
            repo_python = repo / ".venv" / "Scripts" / "python.exe"
            repo_python.parent.mkdir(parents=True)
            repo_python.touch()
            legacy_python = root / "legacy" / "python.exe"
            legacy_python.parent.mkdir()
            legacy_python.touch()
            current_python = root / "current" / "python.exe"

            self.assertEqual(
                synth_launcher.resolve_hub_python({}, repo, legacy_python, current_python),
                repo_python,
            )
            repo_python.unlink()
            self.assertEqual(
                synth_launcher.resolve_hub_python({}, repo, legacy_python, current_python),
                legacy_python,
            )
            legacy_python.unlink()
            self.assertEqual(
                synth_launcher.resolve_hub_python({}, repo, legacy_python, current_python),
                current_python,
            )

    def test_runtime_paths_are_per_user_and_individually_overridable(self) -> None:
        local_app_data = Path("X:/Users/Test/AppData/Local")
        runtime, log_file, lock_file = synth_launcher.resolve_runtime_paths(
            {"LOCALAPPDATA": str(local_app_data)}
        )
        self.assertEqual(runtime, local_app_data / "CommandCenter" / "launcher")
        self.assertEqual(log_file, runtime / "hub.log")
        self.assertEqual(lock_file, runtime / "command-center.lock")

        custom = Path("X:/command-center/runtime")
        runtime, log_file, lock_file = synth_launcher.resolve_runtime_paths(
            {
                "CC_LAUNCHER_RUNTIME_DIR": str(custom),
                "CC_HUB_LOG_FILE": "X:/logs/hub.txt",
                "CC_LAUNCHER_LOCK_FILE": "X:/locks/launcher.lock",
            }
        )
        self.assertEqual(runtime, custom)
        self.assertEqual(log_file, Path("X:/logs/hub.txt"))
        self.assertEqual(lock_file, Path("X:/locks/launcher.lock"))

    def test_repo_hub_uses_repo_cwd_while_legacy_uses_script_folder(self) -> None:
        root = Path("X:/checkout")
        self.assertEqual(
            synth_launcher.resolve_hub_working_directory(root / "backend" / "app.py", root),
            root,
        )
        self.assertEqual(
            synth_launcher.resolve_hub_working_directory(Path("X:/deployed/app.py"), root),
            Path("X:/deployed"),
        )


class LauncherFolderPickerTests(unittest.TestCase):
    def test_picker_uses_pywebview_6_folder_enum(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            selected = str(Path(temporary).resolve())
            window = mock.Mock()
            window.create_file_dialog.return_value = [selected]
            webview = SimpleNamespace(FileDialog=SimpleNamespace(FOLDER="folder-v6"))

            with mock.patch.object(synth_launcher, "webview", webview):
                result = synth_launcher.Api({"w": window}).choose_music_folder()

            self.assertEqual(result, selected)
            window.create_file_dialog.assert_called_once_with("folder-v6", allow_multiple=False)

    def test_picker_falls_back_to_legacy_constant_and_signature(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            selected = str(Path(temporary).resolve())
            calls = []

            class LegacyWindow:
                def create_file_dialog(self, dialog_type, **kwargs):
                    calls.append((dialog_type, kwargs))
                    if kwargs:
                        raise TypeError("allow_multiple is unsupported")
                    return selected

            webview = SimpleNamespace(FOLDER_DIALOG="folder-v5")
            with mock.patch.object(synth_launcher, "webview", webview):
                result = synth_launcher.Api({"w": LegacyWindow()}).choose_video_folder()

            self.assertEqual(result, selected)
            self.assertEqual(
                calls,
                [("folder-v5", {"allow_multiple": False}), ("folder-v5", {})],
            )


if __name__ == "__main__":
    unittest.main()
