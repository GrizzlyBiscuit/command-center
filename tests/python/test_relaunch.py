import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from backend import relaunch


class RelaunchConfigurationTests(unittest.TestCase):
    def test_windowless_python_uses_sibling_of_active_windows_interpreter(self):
        result = relaunch.windowless_python(
            os.path.join('runtime', 'python.exe'),
            platform='win32',
            is_file=lambda path: path.endswith('pythonw.exe'),
        )
        self.assertEqual(result, os.path.join('runtime', 'pythonw.exe'))

    def test_windowless_python_keeps_current_interpreter_when_sibling_is_missing(self):
        executable = os.path.join('runtime', 'python.exe')
        result = relaunch.windowless_python(
            executable,
            platform='win32',
            is_file=lambda _path: False,
        )
        self.assertEqual(result, executable)

    def test_relaunch_command_carries_current_runtime_configuration(self):
        with mock.patch.object(relaunch, 'windowless_python', return_value='active-pythonw'):
            command = relaunch.build_relaunch_command(
                executable='active-python',
                helper_path='checkout/backend/relaunch.py',
                old_pid=321,
                app_path='checkout/backend/app.py',
                cwd='checkout',
                port=6123,
            )
        self.assertEqual(command, [
            'active-pythonw',
            'checkout/backend/relaunch.py',
            '321',
            '--python', 'active-pythonw',
            '--app', 'checkout/backend/app.py',
            '--cwd', 'checkout',
            '--port', '6123',
        ])

    def test_parse_args_accepts_runtime_handoff_values(self):
        args = relaunch.parse_args([
            '321',
            '--python', 'active-pythonw',
            '--app', 'checkout/backend/app.py',
            '--cwd', 'checkout',
            '--port', '6123',
            '--temp-port', '6125',
        ])
        self.assertEqual(args.old_pid, 321)
        self.assertEqual(args.python, 'active-pythonw')
        self.assertEqual(args.app, 'checkout/backend/app.py')
        self.assertEqual(args.cwd, 'checkout')
        self.assertEqual(args.port, 6123)
        self.assertEqual(args.temp_port, 6125)

    @mock.patch.object(relaunch.subprocess, 'Popen')
    def test_spawn_hub_preserves_paths_and_sets_requested_port(self, popen):
        relaunch.spawn_hub('runtime-python', 'checkout/backend/app.py', 'checkout', 6124)
        command, = popen.call_args.args
        options = popen.call_args.kwargs
        self.assertEqual(command, ['runtime-python', 'checkout/backend/app.py'])
        self.assertEqual(options['cwd'], 'checkout')
        self.assertEqual(options['env']['FLASK_PORT'], '6124')
        self.assertEqual(options['creationflags'], relaunch.CREATE_NO_WINDOW)

    def test_final_ownership_record_is_atomic_and_contains_process_identity(self):
        process = mock.Mock(pid=734)
        observed_pids = []

        class ProcessIdentity:
            def create_time(self):
                return 1234.5

        def process_factory(pid):
            observed_pids.append(pid)
            return ProcessIdentity()

        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'state' / 'hub.json'
            result = relaunch.write_hub_ownership(
                target,
                process,
                'checkout/backend/app.py',
                process_factory=process_factory,
            )
            record = json.loads(target.read_text(encoding='utf-8'))
            leftovers = list(target.parent.glob(f'.{target.name}.*.tmp'))

        self.assertTrue(result)
        self.assertEqual(observed_pids, [734])
        self.assertEqual(record, {
            'pid': 734,
            'create_time': 1234.5,
            'script': str(Path('checkout/backend/app.py').resolve()),
        })
        self.assertEqual(leftovers, [])

    def test_ownership_write_failure_does_not_escape(self):
        process = mock.Mock(pid=735)
        result = relaunch.write_hub_ownership(
            'ignored.json',
            process,
            'checkout/backend/app.py',
            process_factory=lambda _pid: (_ for _ in ()).throw(RuntimeError('unavailable')),
        )
        self.assertFalse(result)

    def test_lifetime_guard_requires_exact_token_and_latches_cancellation(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'launcher.alive'
            marker.write_text('instance-123', encoding='utf-8')
            keep_running = relaunch.launcher_lifetime_guard(marker, 'instance-123')
            self.assertTrue(keep_running())
            marker.write_text('instance-123\n', encoding='utf-8')
            self.assertFalse(keep_running())
            marker.write_text('instance-123', encoding='utf-8')
            self.assertFalse(keep_running())

    def test_lifetime_guard_preserves_standalone_mode(self):
        self.assertTrue(relaunch.launcher_lifetime_guard(None, None)())

    @mock.patch.object(relaunch.time, 'sleep')
    @mock.patch.object(relaunch, 'port_open', return_value=False)
    def test_wait_open_stops_when_keep_running_cancels(self, port_open, _sleep):
        decisions = iter([True, False])
        result = relaunch.wait_open(6124, max_s=1, keep_running=lambda: next(decisions))
        self.assertFalse(result)
        port_open.assert_called_once_with(6124)

    def test_clear_ownership_refuses_a_different_final_pid(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'hub.json'
            target.write_text(json.dumps({'pid': 999}), encoding='utf-8')
            self.assertFalse(relaunch.clear_hub_ownership(target, 801))
            self.assertTrue(target.exists())

    @mock.patch.object(relaunch, 'write_hub_ownership')
    @mock.patch.object(relaunch, 'wait_open')
    @mock.patch.object(relaunch, 'spawn_hub')
    def test_cancellation_during_warmup_kills_temp_without_spawning_final(
        self, spawn_hub, wait_open, write_ownership,
    ):
        temporary = mock.Mock(pid=800)
        spawn_hub.return_value = temporary
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'launcher.alive'
            marker.write_text('instance-123', encoding='utf-8')

            def cancel_during_wait(_port, _max_s, *, keep_running):
                marker.unlink()
                return keep_running()

            wait_open.side_effect = cancel_during_wait
            with mock.patch.dict(os.environ, {
                'CC_LAUNCHER_LIFETIME_FILE': str(marker),
                'CC_LAUNCHER_INSTANCE_TOKEN': 'instance-123',
            }, clear=True):
                result = relaunch.main([
                    '--python', 'active-pythonw',
                    '--app', 'checkout/backend/app.py',
                    '--cwd', 'checkout',
                    '--port', '6123',
                    '--temp-port', '6124',
                ])

        self.assertEqual(result, 1)
        self.assertEqual(spawn_hub.call_count, 1)
        temporary.kill.assert_called_once_with()
        write_ownership.assert_not_called()

    @mock.patch.object(relaunch, 'wait_open', return_value=True)
    @mock.patch.object(relaunch, 'spawn_hub')
    def test_cancellation_after_final_spawn_cleans_both_processes_and_ownership(
        self, spawn_hub, _wait_open,
    ):
        temporary = mock.Mock(pid=800)
        final = mock.Mock(pid=801)
        spawn_hub.side_effect = [temporary, final]
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'launcher.alive'
            ownership = Path(directory) / 'hub.json'
            marker.write_text('instance-123', encoding='utf-8')

            def publish_then_cancel(_pid_file, process, _app):
                ownership.write_text(json.dumps({'pid': process.pid}), encoding='utf-8')
                marker.unlink()
                return True

            with mock.patch.object(
                relaunch, 'write_hub_ownership', side_effect=publish_then_cancel,
            ), mock.patch.dict(os.environ, {
                'CC_HUB_PID_FILE': str(ownership),
                'CC_LAUNCHER_LIFETIME_FILE': str(marker),
                'CC_LAUNCHER_INSTANCE_TOKEN': 'instance-123',
            }, clear=True):
                result = relaunch.main([
                    '--python', 'active-pythonw',
                    '--app', 'checkout/backend/app.py',
                    '--cwd', 'checkout',
                    '--port', '6123',
                    '--temp-port', '6124',
                ])
            ownership_exists = ownership.exists()

        self.assertEqual(result, 1)
        final.kill.assert_called_once_with()
        temporary.kill.assert_called_once_with()
        self.assertFalse(ownership_exists)

    @mock.patch.object(relaunch, 'write_hub_ownership')
    @mock.patch.object(relaunch, 'wait_open', side_effect=[True, True])
    @mock.patch.object(relaunch, 'spawn_hub')
    def test_only_final_hub_replaces_ownership(self, spawn_hub, _wait_open, write_ownership):
        temporary = mock.Mock(pid=800)
        final = mock.Mock(pid=801)
        spawn_hub.side_effect = [temporary, final]
        with mock.patch.dict(os.environ, {'CC_HUB_PID_FILE': 'runtime/hub.json'}, clear=True):
            result = relaunch.main([
                '--python', 'active-pythonw',
                '--app', 'checkout/backend/app.py',
                '--cwd', 'checkout',
                '--port', '6123',
                '--temp-port', '6124',
            ])

        self.assertEqual(result, 0)
        write_ownership.assert_called_once_with(
            'runtime/hub.json', final, 'checkout/backend/app.py',
        )
        temporary.kill.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
