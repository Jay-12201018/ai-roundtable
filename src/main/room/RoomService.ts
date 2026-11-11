import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { roomManagementContracts as contracts } from '../../shared/contracts/configuration';
import type {
  RoomManagementApiContract, CreateRoomInput, RoomInput, ConfigurationIdInput, ListRoomsInput,
  ArchiveConfigurationInput, CreateAgentInput, AgentInput, ListAgentConfigurationsInput,
  ReorderAgentsInput, RoomMessagePageInput, RoomRunPageInput, CreateStandaloneInput,
} from '../../shared/contracts/configuration';
import { ContractError, toPublicError } from '../../shared/contracts/errors';
import type { Database } from '../database/Database';

/** Main-only configuration service; persistence and history protection stay in Database. */
export class RoomService implements RoomManagementApiContract {
  constructor(private readonly database: Database) {}

  createRoom = (input: CreateRoomInput) => this.call(contracts.createRoom, input,
    value => this.database.createRoom({ ...value, id: randomUUID() }));
  updateRoom = (input: RoomInput) => this.call(contracts.updateRoom, input, value => this.database.updateRoom(value));
  getRoomConfiguration = (input: ConfigurationIdInput) => this.call(contracts.getRoomConfiguration, input,
    ({ id }) => this.required(this.database.getRoomConfiguration(id)));
  listRooms = (input?: ListRoomsInput) => this.call(contracts.listRooms, input, value => this.database.listRooms(value));
  archiveRoom = (input: ArchiveConfigurationInput) => this.call(contracts.archiveRoom, input,
    ({ id, archived }) => this.database.archiveRoom(id, archived));
  deleteRoom = (input: ConfigurationIdInput) => this.call(contracts.deleteRoom, input, ({ id }) => this.database.deleteRoom(id));
  createAgent = (input: CreateAgentInput) => this.call(contracts.createAgent, input,
    value => this.database.createAgent({ ...value, id: randomUUID() }));
  updateAgent = (input: AgentInput) => this.call(contracts.updateAgent, input, value => this.database.updateAgent(value));
  getAgentConfiguration = (input: ConfigurationIdInput) => this.call(contracts.getAgentConfiguration, input,
    ({ id }) => this.required(this.database.getAgentConfiguration(id)));
  listAgentConfigurations = (input: ListAgentConfigurationsInput) => this.call(contracts.listAgentConfigurations, input,
    ({ roomId, includeArchived }) => this.database.listAgentConfigurations(roomId, includeArchived));
  reorderAgents = (input: ReorderAgentsInput) => this.call(contracts.reorderAgents, input,
    ({ roomId, agentIds }) => this.database.reorderAgents(roomId, agentIds));
  archiveAgent = (input: ArchiveConfigurationInput) => this.call(contracts.archiveAgent, input,
    ({ id, archived }) => this.database.archiveAgent(id, archived));
  deleteAgent = (input: ConfigurationIdInput) => this.call(contracts.deleteAgent, input, ({ id }) => this.database.deleteAgent(id));
  listRoomMessages = (input: RoomMessagePageInput) => this.call(contracts.listRoomMessages, input, value => this.database.listRoomMessages(value));
  listRoomRuns = (input: RoomRunPageInput) => this.call(contracts.listRoomRuns, input, value => this.database.listRoomRuns(value));
  getLineup = () => this.call(contracts.getLineup, undefined, () => this.database.getLineup());
  createStandalone = (input?: CreateStandaloneInput) => this.call(contracts.createStandalone, input, value => this.database.createStandalone(value, randomUUID));
  listStandalone = (input?: ListRoomsInput) => this.call(contracts.listStandalone, input, value => this.database.listStandalone(value));

  private required<T>(value: T | undefined): T {
    if (value === undefined) throw new ContractError('not_found');
    return value;
  }

  private async call<I extends z.ZodType, O extends z.ZodType>(contract: { input: I; output: O }, input: unknown,
    work: (input: z.output<I>) => unknown): Promise<z.output<O>> {
    try {
      const parsed = contract.input.safeParse(input);
      if (!parsed.success) throw new ContractError('invalid_input');
      const result = contract.output.safeParse(work(parsed.data));
      if (!result.success) throw new ContractError('invalid_response');
      return result.data;
    } catch (error) {
      const detail = toPublicError(error);
      throw new ContractError(detail.code, detail.field);
    }
  }
}
