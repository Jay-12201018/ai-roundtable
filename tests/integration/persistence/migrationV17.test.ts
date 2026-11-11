// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Sqlite from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { Database, LINEUP_ROOM_ID } from '../../../src/main/database/Database';
import { migration2 } from '../../../src/main/database/migrations/v2';
import { migration3 } from '../../../src/main/database/migrations/v3';
import { migration4 } from '../../../src/main/database/migrations/v4';
import { migration5 } from '../../../src/main/database/migrations/v5';
import { migration6 } from '../../../src/main/database/migrations/v6';
import { migration7 } from '../../../src/main/database/migrations/v7';
import { migration8 } from '../../../src/main/database/migrations/v8';
import { migration9 } from '../../../src/main/database/migrations/v9';
import { migration10 } from '../../../src/main/database/migrations/v10';
import { migration11 } from '../../../src/main/database/migrations/v11';
import { migration12 } from '../../../src/main/database/migrations/v12';
import { migration13 } from '../../../src/main/database/migrations/v13';
import { migration14 } from '../../../src/main/database/migrations/v14';
import { migration15 } from '../../../src/main/database/migrations/v15';
import { migration16 } from '../../../src/main/database/migrations/v16';
import { validateDatabase } from '../../../src/main/database/recovery/validateDatabase';
import { RunService } from '../../../src/main/services/RunService';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { starterTemplates } from '../../../src/renderer/features/rooms/templates';

const later = [migration2, migration3, migration4, migration5, migration6, migration7, migration8, migration9, migration10, migration11, migration12, migration13, migration14, migration15, migration16];
const v1 = readFileSync(resolve(__dirname, '../../../src/main/database/Database.ts'), 'utf8').match(/const migrations = \[\s*`([\s\S]*?)`/u)![1]!;
const time = (minute: number) => `2026-11-01T02:${String(minute).padStart(2, '0')}:00.000Z`;
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const tables = ['rooms', 'agents', 'workflow_runs', 'turns', 'messages', 'run_events'];
const rows = (raw: Sqlite.Database, table: string, columns = '*') => JSON.stringify(raw.prepare(`SELECT ${columns} FROM ${table} ORDER BY rowid`).all());

/**
 * What version 16 left behind: four rooms. 群聊房间 last talked as a group chat; 审查房间 used a stricter flow and then, earlier, a
 * group chat; 旧房间 has only a discussion from before flows existed; 空房间 was archived and never discussed anything.
 */
function historical(): string {
  const directory = mkdtempSync(join(tmpdir(), 'roundtable-v17-')); directories.push(directory);
  const path = join(directory, 'old.db');
  const db = new Sqlite(path);
  db.exec(v1);
  db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  db.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(time(0));
  // Written the way version 1 wrote it, so every later migration fills in its own columns as it did for real data.
  const room = db.prepare('INSERT INTO rooms(id,name,objective,created_at,updated_at) VALUES(?,?,?,?,?)');
  room.run('chat', '群聊房间', '默认目标', time(1), time(1)); room.run('review', '审查房间', '', time(2), time(2));
  room.run('old', '旧房间', '', time(3), time(3)); room.run('empty', '空房间', '', time(4), time(4));
  const agent = db.prepare('INSERT INTO agents(id,room_id,display_name,role_template_id,system_prompt,display_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
  for (const id of ['chat', 'review', 'old', 'empty']) { agent.run(`${id}-a`, id, '起草者', '起草', '写初稿', 0, time(1), time(1)); agent.run(`${id}-b`, id, '审查者', '审查', '', 1, time(1), time(1)); }
  const run = db.prepare('INSERT INTO workflow_runs(id,room_id,status,workflow_snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?)');
  const runs = [['chat-1', 'chat', '{"templateId":"draft-review-finalize","version":1}', '第一场'], ['chat-2', 'chat', '{"templateId":"group-chat","version":1}', '第二场'],
    ['review-1', 'review', '{"templateId":"group-chat","version":1}', '先聊聊'],
    ['review-2', 'review', JSON.stringify({ version: 1, roomId: 'review', config: { version: 1, templateId: 'review-revision' } }), '审一下方案'],
    ['old-1', 'old', '{"templateId":"draft-review-finalize","version":1}', null]] as const;
  let request = 0;
  for (const [index, [runId, roomId, snapshot]] of runs.entries()) {
    run.run(runId, roomId, 'completed', snapshot, time(10 + index), time(10 + index));
    for (const [turnIndex, suffix] of ['a', 'b'].entries()) {
      const turn = `${runId}-t${turnIndex}`;
      db.prepare('INSERT INTO turns(id,run_id,agent_id,status,request_id,turn_index,partial_content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(turn, runId, `${roomId}-${suffix}`, 'completed', `r${++request}`, turnIndex, '', time(20 + request), time(20 + request));
      db.prepare('INSERT INTO messages(id,room_id,run_id,turn_id,sender_type,sender_name,content,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(`m-${turn}`, roomId, runId, turn, 'agent', suffix === 'a' ? '起草者' : '审查者', `发言 ${turn}`, 'completed', time(20 + request), time(20 + request));
    }
  }
  later.forEach((migration, index) => { db.exec(migration); db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(index + 2, time(0)); });
  // What later versions recorded: the goal and who took part, and a room the host archived.
  const members = (id: string) => JSON.stringify(['a', 'b'].map((suffix, displayOrder) => ({ agentId: `${id}-${suffix}`, displayName: suffix === 'a' ? '起草者' : '审查者', roleTemplateId: suffix === 'a' ? '起草' : '审查', systemPrompt: '', providerId: null, modelId: null, displayOrder })));
  for (const [runId, roomId, , task] of runs) if (task !== null) db.prepare('UPDATE workflow_runs SET task=?,members_snapshot=?,next_turn_index=2,elapsed_execution_ms=10 WHERE id=?').run(task, members(roomId), runId);
  db.prepare('UPDATE rooms SET archived_at=? WHERE id=?').run(time(5), 'empty');
  expect(validateDatabase(db).schemaVersion).toBe(16);
  db.close();
  return path;
}

describe('migration 17 (D167): rooms become projects', () => {
  it('upgrades version 16 with a verified backup; every room, member, discussion and message is as it was', async () => {
    const path = historical();
    const before = new Sqlite(path, { readonly: true });
    const kept = Object.fromEntries(tables.map(table => [table, rows(before, table)]));
    const counts = Object.fromEntries(tables.map(table => [table, before.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get()]));
    before.close();
    const db = new Database(path); await db.initialize();
    // Every room from before is a project, in the order it had, with nothing written into the new fields but the mode.
    const projects = db.listRooms({ includeArchived: true });
    expect(projects.map(room => [room.id, room.name, room.kind, room.brief, room.defaultMode, room.archivedAt !== null])).toEqual([
      ['chat', '群聊房间', 'project', '', 'group-chat', false],
      // D170: the last discussion says which stricter flow the room was using.
      ['review', '审查房间', 'project', '', 'review-revision', false],
      // A discussion from before flows existed is not a choice of flow: the room starts as a group chat (D149).
      ['old', '旧房间', 'project', '', 'group-chat', false],
      ['empty', '空房间', 'project', '', 'group-chat', true],
    ]);
    expect(projects[0]!.objective).toBe('默认目标');
    // History reads as it did: the discussions of a project, their members and their words.
    const service = new RunService(db, new MockProvider());
    expect(db.listRoomRuns({ roomId: 'chat', limit: 100 }).items.map(run => [run.id, run.task, run.groupChat])).toEqual([['chat-1', '第一场', undefined], ['chat-2', '第二场', true]]);
    expect(service.getSnapshot('review-2').messages.map(message => message.content)).toEqual(['发言 review-2-t0', '发言 review-2-t1']);
    expect(service.getSnapshot('review-2').execution?.membersSnapshot?.map(member => member.displayName)).toEqual(['起草者', '审查者']);
    expect(db.listAgentConfigurations('chat').map(agent => [agent.id, agent.displayName, agent.builtInDemo])).toEqual([['chat-a', '起草者', true], ['chat-b', '审查者', true]]);
    // No discussion became a 独立讨论, and the lineup is the three default members with no model chosen yet.
    expect(db.listStandalone({ includeArchived: true })).toEqual([]);
    expect(db.getLineup()).toMatchObject({ id: LINEUP_ROOM_ID, kind: 'lineup', archivedAt: null });
    expect(db.listAgentConfigurations(LINEUP_ROOM_ID).map(agent => ({ name: agent.displayName, role: agent.roleTemplateId, prompt: agent.systemPrompt, model: agent.modelId, enabled: agent.enabled, demo: agent.builtInDemo })))
      .toEqual(starterTemplates.map(template => ({ name: template.name, role: template.role, prompt: template.prompt, model: null, enabled: true, demo: undefined })));
    db.close();

    const raw = new Sqlite(path);
    try {
      expect(validateDatabase(raw).schemaVersion).toBe(17);
      expect(raw.prepare('SELECT version FROM schema_backups').pluck().all()).toEqual([16]);
      // Row for row: nothing but the lineup was added, and nothing that was there changed.
      for (const table of ['workflow_runs', 'turns', 'messages', 'run_events']) expect(rows(raw, table)).toBe(kept[table]);
      const old = "id NOT LIKE 'roundtable-lineup%'";
      expect(JSON.stringify(raw.prepare(`SELECT id,name,objective,created_at,updated_at,archived_at FROM rooms WHERE ${old} ORDER BY rowid`).all())).toBe(kept.rooms);
      expect(JSON.stringify(raw.prepare(`SELECT id,room_id,display_name,role_template_id,provider_id,model_id,system_prompt,enabled,display_order,created_at,updated_at,archived_at,configuration_version FROM agents WHERE ${old} ORDER BY rowid`).all())).toBe(kept.agents);
      expect(raw.prepare('SELECT COUNT(*) FROM rooms').pluck().get()).toBe(Number(counts.rooms) + 1);
      expect(raw.prepare('SELECT COUNT(*) FROM agents').pluck().get()).toBe(Number(counts.agents) + 3);
      expect((raw.pragma('foreign_key_check') as unknown[])).toEqual([]);
    } finally { raw.close(); }
  });

  it('holds what the new kinds promise at the database, whatever the code above it does', () => {
    const db = new Database(':memory:'); db.initialize();
    const raw = (db as unknown as { db: Sqlite.Database }).db;
    expect(raw.prepare('SELECT kind FROM rooms').pluck().all()).toEqual(['lineup']);
    const insert = (id: string, kind: string) => raw.prepare("INSERT INTO rooms(id,name,objective,created_at,updated_at,kind) VALUES(?,?,'','t','t',?)").run(id, id, kind);
    expect(() => insert('second', 'lineup')).toThrow();
    expect(() => insert('other', 'folder')).toThrow();
    insert('p', 'project'); insert('s', 'standalone');
    expect(() => raw.prepare("UPDATE rooms SET kind='lineup' WHERE id='p'").run()).toThrow();
    expect(() => raw.prepare("UPDATE rooms SET kind='project' WHERE id=?").run(LINEUP_ROOM_ID)).toThrow(/lineup/u);
    expect(() => raw.prepare('DELETE FROM rooms WHERE id=?').run(LINEUP_ROOM_ID)).toThrow(/lineup/u);
    expect(() => raw.prepare("UPDATE rooms SET archived_at='t' WHERE id=?").run(LINEUP_ROOM_ID)).toThrow(/lineup/u);
    expect(() => raw.prepare("INSERT INTO workflow_runs(id,room_id,status,workflow_snapshot,created_at,updated_at) VALUES('r',?,'idle','{}','t','t')").run(LINEUP_ROOM_ID)).toThrow(/lineup/u);
    expect(() => raw.prepare("UPDATE rooms SET default_mode='chat' WHERE id='p'").run()).toThrow();
    expect(() => raw.prepare('UPDATE rooms SET brief=? WHERE id=?').run('长'.repeat(4001), 'p')).toThrow();
    // A 独立讨论 may become a project later (the second phase can offer that); the lineup never changes.
    raw.prepare("UPDATE rooms SET kind='project' WHERE id='s'").run();
    expect(validateDatabase(raw).schemaVersion).toBe(17);
    db.close();
  });

  it('gives a new database the same lineup', () => {
    const db = new Database(':memory:'); db.initialize();
    expect(db.listRooms({ includeArchived: true })).toEqual([]);
    expect(db.listAgentConfigurations(LINEUP_ROOM_ID).map(agent => agent.displayName)).toEqual(['林舟', '阿哲', '小雨']);
    db.close();
  });
});
