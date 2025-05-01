import { Room } from './room';
import { ConnectedClient, Currency, Exit, Item } from '../types';
import { NPC } from '../combat/npc';

// Core RoomManager interface
export interface IRoomManager {
  getRoom(roomId: string): Room | undefined;
  addRoomIfNotExists(room: Room): void;
  updateRoom(room: Room): void;
  getStartingRoomId(): string;
  getAllRooms(): Room[];
  forceSave(): void;
}

// Movement service interface
export interface IPlayerMovementService {
  movePlayer(client: ConnectedClient, direction: string): boolean;
  movePlayerWithDelay(client: ConnectedClient, direction: string): boolean;
}

// Entity registry interface
export interface IEntityRegistryService {
  findClientByUsername(username: string): ConnectedClient | undefined;
  getNPCFromRoom(roomId: string, npcId: string): NPC | null;
  removeNPCFromRoom(roomId: string, npcInstanceId: string): boolean;
  storeNPC(npcId: string, npc: NPC): void;
  lookAtEntity(client: ConnectedClient, entityName: string): boolean;
}

// NPC interaction interface
export interface INPCInteractionService {
  instantiateNpcsFromTemplates(room: Room, npcTemplateIds: string[], npcData: Map<string, any>): void;
}

// Room UI notification interface
export interface IRoomUINotificationService {
  lookRoom(client: ConnectedClient): boolean;
  briefLookRoom(client: ConnectedClient): boolean;
  notifyPlayersInRoom(roomId: string, message: string, excludeUsername?: string): void;
  announcePlayerEntrance(roomId: string, username: string): void;
}

// Teleportation service interface
export interface ITeleportationService {
  teleportToStartingRoom(client: ConnectedClient): boolean;
  teleportToStartingRoomIfNeeded(client: ConnectedClient): boolean;
  removePlayerFromAllRooms(username: string): void;
}

// Helper interfaces
export interface IDirectionHelper {
  getOppositeDirection(direction: string): string;
  getFullDirectionName(direction: string): string;
}