# R04 latest source-matched delivery verification

Executed2026-10-15 Asia/Shanghai after the final deadline/abort guard and regression were added. These delivery-* results are the fresh final evidence; earlier final/electron-final reports preserve their earlier candidate identity.

Worktree: `/Users/zhangwenjie/.codex/worktrees/5419/AI交互`; base HEAD `37766666ff10981c302e54636cd0f0378d1c722e`, with root-owned R04 source changes. Private root ROOT=`/private/tmp/roundtable-r04-validation-voe8o8pd`.

| label | mode | timeout seconds | exit | elapsed seconds | tests |
| --- | --- | --- | --- | --- | --- |
| delivery-native-node | node | 150.0 | 0 | 10.917 |  |
| delivery-node-memory | node | 30.0 | 0 | 0.561 |  |
| delivery-node-r04 | node | 90.0 | 0 | 1.154 | 7 files/88 tests |
| delivery-node-full | node | 150.0 | 0 | 13.775 | 29 files/365 tests |
| delivery-typecheck | tool | 60.0 | 0 | 1.172 |  |
| delivery-build | tool | 90.0 | 0 | 1.931 |  |
| delivery-native-electron | electron | 150.0 | 0 | 11.001 |  |
| delivery-electron-memory | electron-node | 30.0 | 0 | 0.513 |  |
| delivery-electron-r04-r03 | electron-node | 120.0 | 0 | 1.789 | 16 files/173 tests |

Each outer command was `python3 ROOT/run-check.py LABEL TIMEOUT MODE ARGV...`. Exact executed argv/wrapper/cwd/start time/base HEAD/tree/status/exit is in LABEL.json; complete stdout/stderr is logs/LABEL.log. No timeout or failure occurred in this fresh final sequence.

Actual argv in sequential order:

- `pnpm run native:node`
- `node ROOT/sqlite-probe.cjs`
- `pnpm exec vitest run tests/unit/stateMachine.test.ts tests/unit/mockProvider.test.ts tests/integration/runControls.test.ts tests/integration/mockRun.test.ts tests/integration/run --reporter=dot`
- `pnpm run test --reporter=dot`
- `pnpm run typecheck`
- `pnpm run build`
- `pnpm run native:electron --build-from-source`
- `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ROOT/sqlite-probe.cjs`
- `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/stateMachine.test.ts tests/unit/mockProvider.test.ts tests/integration/runControls.test.ts tests/integration/mockRun.test.ts tests/integration/run tests/unit/database.test.ts tests/unit/persistence tests/integration/persistence --reporter=dot`

Node rebuilt the existing locked better-sqlite3 for official24.18.1/darwin-arm64/ABI137, full matching runtime include/config and explicit Node+pnpm11.25.0 recursive shim. SQLite :memory: write/read/close was actual. The full pnpm test command independently reran its native pretest; there was no test skip/weakening. Saved actual config: delivery-node-build-config.gypi. Node target: `{"abi": 137, "arch": "arm64", "nodedir": "/private/tmp/roundtable-r04-validation-voe8o8pd/runtime/node-v24.18.1-darwin-arm64", "nativeSha256": "33b3e7f87f3dc1019c1a4d45b51ab3430830146927fccceaeaa08ca46b61f07d", "nativeInode": 10736956}`.

Typecheck actual tsc --noEmit --pretty false passed. Production build actual tsc and electron-vite passed; Main112.62kB, CJS Preload213.17kB, Renderer653.05kB JS generated. No app/Main was imported or launched.

Electron was rebuilt only after all Node checks finished. Actual Electron38.8.6/embeddedNode22.22.0/ABI139 :memory: load/write/read/close passed, then the exact requested combined R04/R03 suite passed16 files/173 tests. Actual build nodedir is private38.8.6, target_arch arm64/module139. Saved config: delivery-electron-build-config.gypi. Final target: `{"abi": 139, "arch": "arm64", "nodedir": "/private/tmp/roundtable-r04-validation-voe8o8pd/electron-headers/38.8.6", "nativeSha256": "be8e575eb62c1a56c57192e0e183c17f687f122d1e8e1af084eb043c661f0fba", "nativeInode": 10737893}`. The native SHA remained identical after the tests.

All77 tracked plus new src/tests/config files were captured at both start and end; both manifests are byte-identical, SHA256 `8e1af8142c42dd7ab4fa7030f9780399dbb64b7f5cba9ee263bc4b92547da8aa`. Source was stable across all final checks. Installed pnpm lock remains byte-identical to repository lock. Source/report/Git edits belong to root; this validation agent edited no repository files.

Warnings: existing Node compilation libc++ platform-support and function-pointer-cast warnings; production Rollup warnings remove two Zod PURE annotations due to comment position. No test/build/Electron failure; no assertion/config was loosened to silence warnings.

Headers provenance: exact private125-file38.8.6 cache copy matches prior R03 main/integration and ~/.electron-gyp; Node22.22.0, built_with_electron1,ABI139,arm64. Local official header tarball/SHASUM was unavailable, so this is reverified known cache provenance, not a new official-header download/archive verification. Installed Electron executable matches the package-checksum-verified cached zip. See electron-preparation.json for full hashes.

Final native target is Electron ABI139. Do not run host Node SQLite without an intentional controlled Node rebuild. No app/Main/userData/real DB/Key/Provider/network/E2E/packaging/platform-release checks were performed. Earlier actual five300000-iteration natural-GC Node stress results remain a separate environment check and were not relabeled as rerun after this guard.
