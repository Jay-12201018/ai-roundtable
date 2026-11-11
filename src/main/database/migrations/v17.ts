// D167: 项目 and 独立讨论. A room gets a kind: every existing room is a 项目 and keeps its rows as they are; a 独立讨论 is a room
// of its own that holds one discussion, so its members, snapshot, Run and messages work as they always did; the single 常用阵容
// room holds the members a new 独立讨论 starts with and never holds a Run. `brief` is the 项目说明 every request of a project's
// discussions carries, and `default_mode` is how its new discussions talk. Only columns are added: no table is rebuilt.
//
// D170: where the mode was only remembered in the page's storage, the last discussion says which stricter flow the room used; a
// room that never used one starts as a group chat, as D149 already decided.
//
// The second phase (memory, project results) adds its own tables keyed by rooms.id; `kind` is what tells it which rooms are projects.
export const migration17 = `
ALTER TABLE rooms ADD COLUMN kind TEXT NOT NULL DEFAULT 'project' CHECK(kind IN ('project','standalone','lineup'));
ALTER TABLE rooms ADD COLUMN brief TEXT NOT NULL DEFAULT '' CHECK(typeof(brief)='text' AND length(brief) <= 4000);
ALTER TABLE rooms ADD COLUMN default_mode TEXT NOT NULL DEFAULT 'group-chat' CHECK(default_mode IN ('group-chat','free-chat','two-model-dialogue','review-revision','deep-debate'));
UPDATE rooms SET default_mode = COALESCE((
  SELECT json_extract(r.workflow_snapshot,'$.config.templateId') FROM workflow_runs r
  WHERE r.room_id = rooms.id AND json_valid(r.workflow_snapshot)
  ORDER BY r.created_at DESC, r.id DESC LIMIT 1
), 'group-chat')
WHERE (
  SELECT json_extract(r.workflow_snapshot,'$.config.templateId') FROM workflow_runs r
  WHERE r.room_id = rooms.id AND json_valid(r.workflow_snapshot)
  ORDER BY r.created_at DESC, r.id DESC LIMIT 1
) IN ('free-chat','two-model-dialogue','review-revision','deep-debate');
CREATE INDEX idx_rooms_kind ON rooms(kind, archived_at);
CREATE UNIQUE INDEX idx_rooms_one_lineup ON rooms(kind) WHERE kind='lineup';
CREATE TRIGGER rooms_kind_insert BEFORE INSERT ON rooms WHEN NEW.kind = 'lineup' AND NEW.id <> 'roundtable-lineup' BEGIN
  SELECT RAISE(ABORT,'There is one lineup');
END;
CREATE TRIGGER rooms_kind_fixed BEFORE UPDATE OF kind ON rooms WHEN NEW.kind <> OLD.kind AND (OLD.kind = 'lineup' OR NEW.kind = 'lineup') BEGIN
  SELECT RAISE(ABORT,'The lineup stays the lineup');
END;
CREATE TRIGGER rooms_lineup_stays BEFORE DELETE ON rooms WHEN OLD.kind = 'lineup' BEGIN
  SELECT RAISE(ABORT,'The lineup cannot be deleted');
END;
CREATE TRIGGER rooms_lineup_not_archived BEFORE UPDATE OF archived_at ON rooms WHEN OLD.kind = 'lineup' AND NEW.archived_at IS NOT NULL BEGIN
  SELECT RAISE(ABORT,'The lineup cannot be archived');
END;
CREATE TRIGGER workflow_runs_not_in_lineup BEFORE INSERT ON workflow_runs WHEN (SELECT kind FROM rooms WHERE id = NEW.room_id) = 'lineup' BEGIN
  SELECT RAISE(ABORT,'The lineup holds no discussion');
END;
INSERT INTO rooms(id,name,objective,created_at,updated_at,kind) VALUES('roundtable-lineup','常用阵容','',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'lineup');
INSERT INTO agents(id,room_id,display_name,role_template_id,provider_id,model_id,system_prompt,enabled,display_order,created_at,updated_at,configuration_version) VALUES
  ('roundtable-lineup-member-1','roundtable-lineup','林舟','产品',NULL,NULL,'你叫林舟，性格稳重。看问题先想用户要什么、值不值得做，再谈怎么做；拿主意时说清取舍。',1,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1),
  ('roundtable-lineup-member-2','roundtable-lineup','阿哲','工程',NULL,NULL,'你叫阿哲，爱挑刺。看问题从技术出发，先找漏洞：做不做得出来、哪里会出问题、代价多大。挑刺时给理由，也给改法。',1,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1),
  ('roundtable-lineup-member-3','roundtable-lineup','小雨','总结',NULL,NULL,'你叫小雨，爱总结。大家真的说散了才帮忙理一理：定了什么、还差什么、下一步是什么。被问到看法时先说你自己的看法，不拿小结代替。不抢话，没什么可理的时候就不理。',1,2,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1);
`;
