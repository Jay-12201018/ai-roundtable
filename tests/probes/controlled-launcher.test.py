"""No real profile, Electron, SQLite, Keychain or network is used by these tests."""
import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from types import SimpleNamespace

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/controlled-desktop/launcher.py'


class VersionBindingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='roundtable-launcher-binding-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'Local Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        for name in ('launcher.py', 'main.cjs', 'controlled-network.cjs', 'session-authorization.cjs'):
            p = self.repo / 'scripts/controlled-desktop' / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('fixture\n')
        (self.repo / 'package.json').write_text('{"type":"module"}\n')
        (self.repo / '.gitignore').write_text('node_modules/\n')
        self.git('add', '.')
        self.git('commit', '-m', 'fixture source')
        self.build = self.root / 'build'
        for rel in ('out/main/index.js', 'out/preload/index.cjs', 'out/renderer/index.html', 'package.json'):
            p = self.build / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('fixture output\n')
        for rel in ('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
                    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
                    'node_modules/.pnpm/lock.yaml'):
            p = self.repo / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('fixture runtime\n')
        (self.build / 'node_modules').symlink_to(self.repo / 'node_modules', target_is_directory=True)
        self.assertTrue(SCRIPT.is_file(), 'the version-bound launcher is not implemented')
        spec = importlib.util.spec_from_file_location('controlled_launcher', SCRIPT)
        self.launcher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.launcher)
        self.original = self.launcher.source_state(self.repo)
        self.launcher.write_manifest(self.repo, self.build, self.original, self.launcher.dependency_hashes(self.repo))

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.repo, text=True, stderr=subprocess.DEVNULL).strip()

    def test_current_clean_main_loads_current_build(self):
        self.assertEqual(self.launcher.validate_build(self.repo, self.build)['main'], self.git('rev-parse', 'HEAD'))

    def test_new_main_rejects_old_output(self):
        (self.repo / 'change.txt').write_text('next accepted source\n')
        self.git('add', '.')
        self.git('commit', '-m', 'new main')
        with self.assertRaisesRegex(ValueError, 'stale'):
            self.launcher.validate_build(self.repo, self.build)

    def test_new_build_accepts_new_main_without_changing_profile_identity(self):
        (self.repo / 'change.txt').write_text('new main\n')
        self.git('add', '.')
        self.git('commit', '-m', 'new main')
        self.launcher.write_manifest(self.repo, self.build, self.launcher.source_state(self.repo), self.launcher.dependency_hashes(self.repo))
        self.assertEqual(self.launcher.validate_build(self.repo, self.build)['main'], self.git('rev-parse', 'HEAD'))
        self.assertFalse((self.build / 'owner.json').exists())

    def test_dependency_change_during_build_cannot_be_registered(self):
        starting_dependencies = self.launcher.dependency_hashes(self.repo)
        (self.repo / 'node_modules/better-sqlite3/build/Release/better_sqlite3.node').write_text('changed during build')
        with self.assertRaisesRegex(ValueError, 'dependency'):
            self.launcher.write_manifest(self.repo, self.build, self.original, starting_dependencies)

    def test_dirty_source_is_rejected(self):
        (self.repo / 'package.json').write_text('dirty\n')
        with self.assertRaisesRegex(ValueError, 'clean main'):
            self.launcher.validate_build(self.repo, self.build)

    def test_feature_branch_is_rejected_even_at_main_sha(self):
        self.git('switch', '-c', 'codex/fixture')
        with self.assertRaisesRegex(ValueError, 'clean main'):
            self.launcher.validate_build(self.repo, self.build)

    def test_tampered_production_output_is_rejected(self):
        (self.build / 'out/main/index.js').write_text('stale or tampered\n')
        with self.assertRaisesRegex(ValueError, 'artifact'):
            self.launcher.validate_build(self.repo, self.build)

    def test_missing_preload_is_rejected(self):
        (self.build / 'out/preload/index.cjs').unlink()
        with self.assertRaisesRegex(ValueError, 'artifact'):
            self.launcher.validate_build(self.repo, self.build)

    def test_changed_native_runtime_is_rejected_without_loading_it(self):
        (self.repo / 'node_modules/better-sqlite3/build/Release/better_sqlite3.node').write_text('different ABI\n')
        with self.assertRaisesRegex(ValueError, 'dependency'):
            self.launcher.validate_build(self.repo, self.build)

    def test_symlinked_build_output_cannot_escape_manifest(self):
        (self.build / 'out/main/index.js').unlink()
        (self.build / 'out/main/index.js').symlink_to(self.repo / 'package.json')
        with self.assertRaisesRegex(ValueError, 'artifact'):
            self.launcher.validate_build(self.repo, self.build)

    def test_symlinked_out_root_is_rejected(self):
        moved = self.root / 'external-out'
        (self.build / 'out').rename(moved)
        (self.build / 'out').symlink_to(moved, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'artifact'):
            self.launcher.validate_build(self.repo, self.build)

    def test_symlinked_build_ancestor_is_rejected(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'artifact'):
            self.launcher.validate_build(self.repo, alias / 'build')

    def test_moved_dependency_tree_is_rejected(self):
        (self.build / 'node_modules').unlink()
        elsewhere = self.root / 'other-modules'
        elsewhere.mkdir()
        (self.build / 'node_modules').symlink_to(elsewhere, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'dependency'):
            self.launcher.validate_build(self.repo, self.build)


class ProfileProtectionTests(unittest.TestCase):
    git = VersionBindingTests.git
    def setUp(self):
        VersionBindingTests.setUp(self)
        self.profile = self.root / 'owned-profile'
        self.profile.mkdir(mode=0o700)
        owner = {'uid': os.getuid(), 'root': str(self.profile), 'repo': str(self.repo),
                 'main': '0' * 40, 'appName': 'Owned-Fake-Fixture', 'service': 'fake-service',
                 'accounts': ['fake-account', 'fake-legacy-account']}
        (self.profile / 'owner.json').write_text(json.dumps(owner))
        (self.profile / 'keyguard.dylib').write_text('not executable; metadata only')
        (self.profile / 'manifest.json').write_text(json.dumps({
            'controlledReadyOwnerSha256': self.launcher.sha(self.profile / 'owner.json'),
            'keyguardDylibSha256': self.launcher.sha(self.profile / 'keyguard.dylib')}))
        for name in ('appData', 'userData', 'sessionData', 'logs', 'crashDumps'):
            (self.profile / 'data' / name).mkdir(parents=True)
        for name in ('logs', 'tmp', 'cache', 'config', 'state'):
            (self.profile / name).mkdir()

    def test_old_owner_commit_does_not_override_new_build_commit(self):
        owner = self.launcher.profile_owner(self.repo, self.profile)
        self.assertEqual(owner['main'], '0' * 40)
        self.assertNotEqual(self.launcher.validate_build(self.repo, self.build)['main'], owner['main'])
        self.assertEqual(owner['service'], 'fake-service')
        self.assertEqual(owner['accounts'], ['fake-account', 'fake-legacy-account'])

    def test_changed_identity_is_rejected_before_launch(self):
        (self.profile / 'owner.json').write_text('{}')
        with self.assertRaises((ValueError, KeyError)):
            self.launcher.profile_owner(self.repo, self.profile)

    def test_production_open_refuses_a_dry_fixture_identity(self):
        owner_file = self.profile / 'owner.json'
        owner = json.loads(owner_file.read_text())
        owner['fixtureOnly'] = True
        owner_file.write_text(json.dumps(owner))
        manifest_file = self.profile / 'manifest.json'
        manifest = json.loads(manifest_file.read_text())
        manifest['controlledReadyOwnerSha256'] = self.launcher.sha(owner_file)
        manifest_file.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'fixture'):
            self.launcher.profile_owner(self.repo, self.profile)

    def test_symlinked_profile_data_is_rejected(self):
        p = self.profile / 'data/userData'
        p.rmdir()
        p.symlink_to(self.repo, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'profile path'):
            self.launcher.profile_owner(self.repo, self.profile)

    def test_symlinked_profile_data_root_is_rejected(self):
        moved = self.root / 'external-data'
        (self.profile / 'data').rename(moved)
        (self.profile / 'data').symlink_to(moved, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'profile path'):
            self.launcher.profile_owner(self.repo, self.profile)

    def test_active_process_prevents_second_launch_without_termination(self):
        (self.profile / 'last-open.json').write_text(json.dumps({'pid': os.getpid()}))
        with self.assertRaisesRegex(ValueError, 'active'):
            self.launcher.refuse_running_profile(self.profile)
        os.kill(os.getpid(), 0)

    def test_denied_process_inspection_does_not_mean_no_process(self):
        (self.profile / 'last-open.json').write_text(json.dumps({'pid': os.getpid()}))
        denied = subprocess.CompletedProcess([], 1, stdout='', stderr='Operation not permitted')
        with patch.object(self.launcher.subprocess, 'run', return_value=denied):
            with self.assertRaisesRegex(ValueError, 'cannot be checked'):
                self.launcher.refuse_running_profile(self.profile)

    def test_previous_exited_process_allows_future_manual_open(self):
        process = subprocess.Popen(['/usr/bin/true'])
        process.wait(timeout=5)
        (self.profile / 'last-open.json').write_text(json.dumps({'pid': process.pid}))
        self.launcher.refuse_running_profile(self.profile)

    def test_proxy_requires_explicit_remote_dns_trust(self):
        self.assertIsNone(self.launcher.validate_proxy(None, False))
        self.assertEqual(self.launcher.validate_proxy('http://127.0.0.1:7890', True), 'http://127.0.0.1:7890')
        self.assertEqual(self.launcher.validate_proxy('http://[::1]:8080/', True), 'http://[::1]:8080')
        for proxy, trust in [(None, True), ('http://127.0.0.1:7890', False), ('https://127.0.0.1:7890', True),
                             ('http://localhost:7890', True), ('http://127.1:7890', True), ('http://1.2.3.4:7890', True),
                             ('http://user:secret@127.0.0.1:7890', True), ('http://127.0.0.1:0', True),
                             ('http://127.0.0.1:65536', True), ('http://127.0.0.1:7890/path', True),
                             ('http://127.0.0.1:7890?x', True), ('http://127.0.0.1:07890', True)]:
            with self.subTest(proxy=proxy, trust=trust), self.assertRaisesRegex(ValueError, 'proxy'):
                self.launcher.validate_proxy(proxy, trust)

    def test_proxy_launch_keeps_identity_unarmed_and_ignores_ambient_proxy(self):
        identity = (self.profile / 'owner.json').read_bytes()
        captured = {}
        native_popen = subprocess.Popen

        def fake_open(argv, **kwargs):
            if 'env' not in kwargs:
                return native_popen(argv, **kwargs)
            captured.update(argv=argv, **kwargs)
            Path(kwargs['env']['ROUNDTRIAL_RESULT']).write_text('{"status":"READY"}')
            return SimpleNamespace(pid=999999, poll=lambda: None)

        with patch.dict(os.environ, {'HTTP_PROXY': 'http://user:fake@remote.invalid:1', 'ROUNDTABLE_CONNECT_PROXY': 'http://remote.invalid:2'}):
            with patch.object(self.launcher.subprocess, 'Popen', side_effect=fake_open):
                self.launcher.open_app(self.repo, self.build, self.profile, 'http://127.0.0.1:7890', True)
        env = captured['env']
        self.assertEqual(env['ROUNDTABLE_CONNECT_PROXY'], 'http://127.0.0.1:7890')
        self.assertEqual(env['ROUNDTABLE_TRUST_PROXY_DNS'], '1')
        self.assertNotIn('HTTP_PROXY', env)
        self.assertEqual(env['ROUNDTRIAL_SERVICE'], 'fake-service')
        self.assertEqual(env['ROUNDTRIAL_ACCOUNT'], 'fake-account')
        self.assertEqual(captured['argv'][-2], str(self.profile))
        self.assertEqual((self.profile / 'owner.json').read_bytes(), identity)
        self.assertFalse(json.loads((self.profile / 'last-open.json').read_text())['sendAuthorized'])

    def test_default_route_does_not_inherit_proxy_and_invalid_route_never_opens(self):
        captured = {}
        native_popen = subprocess.Popen

        def fake_open(argv, **kwargs):
            if 'env' not in kwargs:
                return native_popen(argv, **kwargs)
            captured.update(kwargs['env'])
            Path(kwargs['env']['ROUNDTRIAL_RESULT']).write_text('{"status":"READY"}')
            return SimpleNamespace(pid=999999, poll=lambda: None)

        with patch.dict(os.environ, {'ROUNDTABLE_CONNECT_PROXY': 'http://127.0.0.1:7890', 'ROUNDTABLE_TRUST_PROXY_DNS': '1'}):
            with patch.object(self.launcher.subprocess, 'Popen', side_effect=fake_open):
                self.launcher.open_app(self.repo, self.build, self.profile)
        self.assertNotIn('ROUNDTABLE_CONNECT_PROXY', captured)
        self.assertNotIn('ROUNDTABLE_TRUST_PROXY_DNS', captured)
        with patch.object(self.launcher.subprocess, 'Popen') as opened:
            with self.assertRaisesRegex(ValueError, 'proxy'):
                self.launcher.open_app(self.repo, self.build, self.profile, 'http://remote.invalid:7890', True)
            opened.assert_not_called()


if __name__ == '__main__':
    unittest.main()
