import type { Database } from '../../src/main/database/Database';
import type { RoomDiscussionMode, RoomManagementApiContract } from '../../src/shared/contracts/configuration';

/**
 * D167: with nothing open, the app opens a new 独立讨论. Tests whose subject is a project's discussion (its controls, its flow)
 * make that first page the project's own new discussion instead, in the mode they are about, as if the host had opened it from
 * the sidebar. Navigation itself is covered by tests/integration/projects and the e2e specs.
 */
export function landInProject(api: { rooms: RoomManagementApiContract }, db: Database, roomId: string, mode: RoomDiscussionMode = 'free-chat'): void {
  const room = db.getRoomConfiguration(roomId)!;
  db.updateRoom({ id: roomId, name: room.name, objective: room.objective, defaultMode: mode });
  api.rooms = { ...api.rooms, createStandalone: async () => db.getRoomConfiguration(roomId)! };
}
