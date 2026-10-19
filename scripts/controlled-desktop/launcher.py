#!/usr/bin/env python3
"""Build a fresh main snapshot, then open it without granting network permission."""
import argparse
import hashlib
import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

SCRIPTS = ('launcher.py', 'main.cjs', 'controlled-network.cjs', 'session-authorization.cjs')
DEPENDENCIES = ('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
                'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
                'node_modules/.pnpm/lock.yaml')
REQUIRED = {'out/main/index.js', 'out/preload/index.cjs', 'out/renderer/index.html', 'package.json'}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(repo, *args):
    return subprocess.check_output(['git', *args], cwd=repo, text=True, timeout=10).strip()


def source_state(repo):
    if git(repo, 'branch', '--show-current') != 'main' or git(repo, 'status', '--porcelain=v1'):
        raise ValueError('A clean main checkout is required')
    head = git(repo, 'rev-parse', 'HEAD')
    if head != git(repo, 'rev-parse', 'refs/heads/main'):
        raise ValueError('A clean main checkout is required')
    return {'main': head, 'tree': git(repo, 'rev-parse', 'HEAD^{tree}')}


def artifact_hashes(build):
    if build.is_symlink() or build.absolute() != build.resolve() or not build.is_dir():
        raise ValueError('Unsafe artifact directory')
    if (build / 'out').is_symlink():
        raise ValueError('Symlinked artifact directory is not permitted')
    files = [build / 'package.json', *(build / 'out').rglob('*')]
    if any(p.is_symlink() for p in files):
        raise ValueError('Symlinked artifact is not permitted')
    result = {p.relative_to(build).as_posix(): sha(p) for p in files if p.is_file()}
    if not REQUIRED <= result.keys():
        raise ValueError('Missing production artifact')
    return result


def dependency_hashes(repo):
    try:
        return {rel: sha(repo / rel) for rel in DEPENDENCIES}
    except OSError as error:
        raise ValueError('Missing controlled dependency') from error


def script_hashes(repo):
    return {name: sha(repo / 'scripts/controlled-desktop' / name) for name in SCRIPTS}


def write_manifest(repo, build, initial, initial_dependencies):
    if source_state(repo) != initial:
        raise ValueError('Source changed while preparing artifacts')
    if dependency_hashes(repo) != initial_dependencies:
        raise ValueError('Controlled dependency changed during preparation')
    manifest = {'version': 1, 'repo': str(repo.resolve()), **initial,
                'artifacts': artifact_hashes(build), 'dependencies': initial_dependencies,
                'launchers': script_hashes(repo)}
    (build / 'build-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


def validate_build(repo, build):
    current = source_state(repo)
    manifest = json.loads((build / 'build-manifest.json').read_text())
    if manifest.get('version') != 1 or manifest.get('repo') != str(repo.resolve()) or any(manifest.get(k) != v for k, v in current.items()):
        raise ValueError('Build is stale; prepare a new snapshot of current main')
    if artifact_hashes(build) != manifest.get('artifacts'):
        raise ValueError('Production artifact integrity mismatch')
    if dependency_hashes(repo) != manifest.get('dependencies') or (build / 'node_modules').resolve() != (repo / 'node_modules').resolve():
        raise ValueError('Controlled dependency changed; prepare again')
    if script_hashes(repo) != manifest.get('launchers'):
        raise ValueError('Launcher changed; prepare again')
    return manifest


def base_env():
    return {key: os.environ[key] for key in ('HOME', 'USER', 'LOGNAME', 'LANG', 'LC_CTYPE', 'SHELL', '__CF_USER_TEXT_ENCODING') if key in os.environ}


def validate_proxy(proxy, trust_remote_dns):
    if proxy is None and not trust_remote_dns:
        return None
    match = re.fullmatch(r'http://(127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})/?', proxy or '')
    if not trust_remote_dns or not match or int(match[2]) > 65535:
        raise ValueError('Use an explicit loopback HTTP proxy and acknowledge trust in its remote DNS')
    return f'http://{match[1]}:{match[2]}'


def prepare(repo, build, node):
    initial = source_state(repo)
    initial_dependencies = dependency_hashes(repo)
    if build.absolute() != build.resolve():
        raise ValueError('Use a canonical artifact directory without symlink ancestors')
    node = node.resolve(strict=True)
    env = base_env()
    env['PATH'] = str(node.parent) + ':/usr/bin:/bin:/usr/sbin:/sbin'
    runtime = json.loads(subprocess.check_output([str(node), '-p', 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})'], env=env, text=True, timeout=10))
    if runtime != {'version': 'v24.18.1', 'platform': 'darwin', 'arch': 'arm64'}:
        raise ValueError('Use the reviewed Node 24.18.1 darwin-arm64 runtime')
    build.mkdir(mode=0o700, parents=True, exist_ok=False)
    subprocess.run([str(node), 'node_modules/typescript/bin/tsc', '--noEmit', '--pretty', 'false'], cwd=repo, env=env, check=True, timeout=120)
    subprocess.run([str(node), 'node_modules/electron-vite/bin/electron-vite.js', 'build', '--outDir', str(build / 'out')], cwd=repo, env=env, check=True, timeout=180)
    (build / 'package.json').write_text('{"type":"module"}\n')
    (build / 'node_modules').symlink_to(repo / 'node_modules', target_is_directory=True)
    native_env = dict(env, ELECTRON_RUN_AS_NODE='1')
    smoke = "const a=require('node:assert/strict');a.equal(process.versions.modules,'139');const D=require('better-sqlite3');const d=new D(':memory:');try{a.equal(d.prepare('select 1 as n').get().n,1)}finally{d.close()}"
    subprocess.run([str(repo / DEPENDENCIES[0]), '-e', smoke], cwd=build, env=native_env, check=True, timeout=20)
    manifest = write_manifest(repo, build, initial, initial_dependencies)
    print(json.dumps({'status': 'PREPARED', 'main': manifest['main'], 'buildRoot': str(build), 'sendAuthorized': False}))


def profile_owner(repo, profile):
    stat = profile.lstat()
    if profile.is_symlink() or not profile.is_dir() or stat.st_uid != os.getuid() or stat.st_mode & 0o077:
        raise ValueError('Unsafe independent profile directory')
    for name in ('owner.json', 'manifest.json', 'keyguard.dylib'):
        item = profile / name
        if item.is_symlink() or not item.is_file() or item.stat().st_uid != os.getuid():
            raise ValueError('Unsafe independent profile metadata')
    owner = json.loads((profile / 'owner.json').read_text())
    manifest = json.loads((profile / 'manifest.json').read_text())
    if owner.get('fixtureOnly') is True:
        raise ValueError('Production open does not accept a dry fixture identity')
    if owner['uid'] != os.getuid() or owner['root'] != str(profile) or Path(owner['repo']).resolve() != repo.resolve():
        raise ValueError('Independent profile identity mismatch')
    if not all(isinstance(owner.get(key), str) and owner[key] for key in ('appName', 'service')) or not isinstance(owner.get('accounts'), list) or len(owner['accounts']) != 2 or not all(isinstance(a, str) and a for a in owner['accounts']):
        raise ValueError('Invalid independent profile identity')
    if sha(profile / 'owner.json') != manifest['controlledReadyOwnerSha256'] or sha(profile / 'keyguard.dylib') != manifest['keyguardDylibSha256']:
        raise ValueError('Independent profile guard identity changed')
    paths = ['data', 'logs', 'tmp', 'cache', 'config', 'state'] + ['data/' + name for name in ('appData', 'userData', 'sessionData', 'logs', 'crashDumps')]
    for name in paths:
        p = profile / name
        if p.is_symlink() or not p.is_dir():
            raise ValueError('Unsafe independent profile path')
    return owner


def refuse_running_profile(profile):
    last = profile / 'last-open.json'
    if last.is_symlink():
        raise ValueError('Unsafe previous application record')
    if last.exists():
        pid = json.loads(last.read_text())['pid']
        if not isinstance(pid, int) or pid <= 1:
            raise ValueError('Invalid previous application process')
        probe = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'comm='], capture_output=True, text=True, timeout=10)
        if probe.returncode != 1 or probe.stdout.strip() or probe.stderr.strip():
            raise ValueError('Previous profile process is active or cannot be checked; close it manually before opening a new version')


def open_app(repo, build, profile, connect_proxy=None, trust_proxy_dns=False):
    connect_proxy = validate_proxy(connect_proxy, trust_proxy_dns)
    manifest = validate_build(repo, build)
    refuse_running_profile(profile)
    owner = profile_owner(repo, profile)
    label = 'version-bound-' + str(time.time_ns())
    log, guard, result = (profile / 'logs' / (label + suffix) for suffix in ('.log', '-keychain.jsonl', '-result.json'))
    env = base_env()
    env.update(PATH='/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR=str(profile / 'tmp') + '/',
               XDG_CACHE_HOME=str(profile / 'cache'), XDG_CONFIG_HOME=str(profile / 'config'), XDG_STATE_HOME=str(profile / 'state'),
               DYLD_INSERT_LIBRARIES=str(profile / 'keyguard.dylib'), ROUNDTRIAL_SERVICE=owner['service'],
               ROUNDTRIAL_ACCOUNT=owner['accounts'][0], ROUNDTRIAL_LEGACY_ACCOUNT=owner['accounts'][1],
               ROUNDTRIAL_GUARD_LOG=str(guard), ROUNDTRIAL_RESULT=str(result), ROUNDTRIAL_DRY='0')
    if connect_proxy:
        env.update(ROUNDTABLE_CONNECT_PROXY=connect_proxy, ROUNDTABLE_TRUST_PROXY_DNS='1')
    argv = [str(repo / DEPENDENCIES[0]), str(repo / 'scripts/controlled-desktop/main.cjs'), str(build), str(profile), manifest['main']]
    validate_build(repo, build)
    refuse_running_profile(profile)
    if profile_owner(repo, profile) != owner:
        raise ValueError('Independent profile identity changed before launch')
    with os.fdopen(os.open(log, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as output:
        process = subprocess.Popen(argv, cwd=repo, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    record = {'main': manifest['main'], 'argv': argv, 'pid': process.pid, 'startedUtc': datetime.now(timezone.utc).isoformat(), 'sendAuthorized': False,
              'networkRoute': 'trusted-loopback-connect' if connect_proxy else 'direct'}
    (profile / 'last-open.json').write_text(json.dumps(record, indent=2) + '\n')
    for _ in range(300):
        if result.exists():
            state = json.loads(result.read_text())
            if state['status'] in ('READY', 'FAIL'):
                break
        if process.poll() is not None:
            break
        time.sleep(.1)
    if not result.exists() or json.loads(result.read_text())['status'] != 'READY':
        raise ValueError('Startup did not become ready; retained its safe diagnostic log')
    print(json.dumps({'status': 'READY', 'main': manifest['main'], 'pid': process.pid, 'sendAuthorized': False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prepare_parser = commands.add_parser('prepare')
    prepare_parser.add_argument('--node', type=Path, required=True)
    prepare_parser.add_argument('--build-root', type=Path, required=True)
    open_parser = commands.add_parser('open')
    open_parser.add_argument('--build-root', type=Path, required=True)
    open_parser.add_argument('--profile-root', type=Path, required=True)
    open_parser.add_argument('--connect-proxy', help='Explicit http://127.0.0.1:port or http://[::1]:port; credentials are refused')
    open_parser.add_argument('--trust-proxy-dns', action='store_true', help='Trust this local proxy to resolve the fixed HTTPS origin; does not authorize sending')
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    build = args.build_root.absolute()
    if args.command == 'prepare':
        prepare(repo, build, args.node)
    else:
        open_app(repo, build, args.profile_root.absolute(), args.connect_proxy, args.trust_proxy_dns)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError, KeyError, json.JSONDecodeError) as error:
        # Do not print a subprocess environment, profile contents or exception traceback.
        reason = str(error) if isinstance(error, ValueError) and not isinstance(error, json.JSONDecodeError) else type(error).__name__
        raise SystemExit('Controlled launcher refused: ' + reason) from None
