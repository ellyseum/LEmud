import fs from 'fs';
import path from 'path';
import { Room } from './room';
import { ConnectedClient, Currency, Exit, Item } from '../types';
import { systemLogger } from '../utils/logger';
import { NPC } from '../combat/npc';
import { IRoomManager } from './interfaces';

// Import our service classes
import { DirectionHelper } from './services/directionHelper';
import { EntityRegistryService } from './services/entityRegistryService';
import { NPCInteractionService } from './services/npcInteractionService';
import { PlayerMovementService } from './services/playerMovementService';
import { RoomUINotificationService } from './services/roomUINotificationService';
import { TeleportationService } from './services/teleportationService';

const ROOMS_FILE = path.join(__dirname, '..', '..', 'data', 'rooms.json');
const DEFAULT_ROOM_ID = 'start'; // ID for the starting room

interface RoomData {
  id: string;
  shortDescription?: string;
  longDescription?: string;
  name?: string;
  description?: string;
  exits: Exit[];
  items?: string[];
  players?: string[];
  npcs?: string[];
  currency: Currency;
}

export class RoomManager implements IRoomManager {
  private rooms: Map<string, Room> = new Map();
  private clients: Map<string, ConnectedClient>;
  
  // Services - use definite assignment assertions to tell TypeScript they will be initialized
  private directionHelper!: DirectionHelper;
  private entityRegistryService!: EntityRegistryService;
  private npcInteractionService!: NPCInteractionService;
  private playerMovementService!: PlayerMovementService;
  private roomUINotificationService!: RoomUINotificationService;
  private teleportationService!: TeleportationService;
  
  // Add static instance for singleton pattern
  private static instance: RoomManager | null = null;

  // Make constructor private for singleton pattern
  private constructor(clients: Map<string, ConnectedClient>) {
    systemLogger.info('Creating RoomManager instance');
    this.clients = clients;
    
    // Initialize services
    this.initializeServices();
    
    // Load rooms
    this.loadRooms();
    this.ensureStartingRoom();
  }
  
  // Static method to get the singleton instance
  public static getInstance(clients: Map<string, ConnectedClient>): RoomManager {
    if (!RoomManager.instance) {
      RoomManager.instance = new RoomManager(clients);
    } else {
      // Update clients reference if it's a different object
      RoomManager.instance.clients = clients;
    }
    return RoomManager.instance;
  }

  /**
   * Initialize all the service classes
   */
  private initializeServices(): void {
    // Create direction helper first as it's used by other services
    this.directionHelper = new DirectionHelper();
    
    // Create the notification service first since it's used by other services
    this.roomUINotificationService = new RoomUINotificationService(
      {
        getRoom: this.getRoom.bind(this),
        getStartingRoomId: this.getStartingRoomId.bind(this)
      },
      this.findClientByUsername.bind(this),
      {
        teleportToStartingRoom: this.teleportToStartingRoom.bind(this)
      }
    );
    
    this.teleportationService = new TeleportationService(
      {
        getRoom: this.getRoom.bind(this),
        getStartingRoomId: this.getStartingRoomId.bind(this),
        getAllRooms: this.getAllRooms.bind(this)
      },
      this.roomUINotificationService.notifyPlayersInRoom.bind(this.roomUINotificationService)
    );
    
    this.npcInteractionService = new NPCInteractionService(
      {
        updateRoom: this.updateRoom.bind(this)
      }
    );
    
    this.entityRegistryService = new EntityRegistryService(
      {
        getRoom: this.getRoom.bind(this),
        getStartingRoomId: this.getStartingRoomId.bind(this),
        updateRoom: this.updateRoom.bind(this)
      },
      this.clients,
      this.roomUINotificationService.notifyPlayersInRoom.bind(this.roomUINotificationService),
      this.teleportationService.teleportToStartingRoom.bind(this.teleportationService)
    );
    
    this.playerMovementService = new PlayerMovementService(
      {
        getRoom: this.getRoom.bind(this),
        getStartingRoomId: this.getStartingRoomId.bind(this)
      },
      this.directionHelper,
      this.roomUINotificationService.notifyPlayersInRoom.bind(this.roomUINotificationService),
      this.clients
    );
  }

  private loadRooms(): void {
    try {
      if (fs.existsSync(ROOMS_FILE)) {
        const data = fs.readFileSync(ROOMS_FILE, 'utf8');
        const roomDataArray: RoomData[] = JSON.parse(data);
        
        systemLogger.info(`Loading ${roomDataArray.length} rooms...`);
        
        // Load all NPC templates first
        const npcData = NPC.loadNPCData();
        
        roomDataArray.forEach(roomData => {
          const room = new Room(roomData);
          this.rooms.set(room.id, room);
          
          // Instantiate NPCs from templates after room is created
          if (Array.isArray(roomData.npcs)) {
            this.npcInteractionService.instantiateNpcsFromTemplates(room, roomData.npcs, npcData);
          }
        });
        
        systemLogger.info('Rooms loaded successfully');
      } else {
        // Create initial rooms file if it doesn't exist
        this.saveRooms();
      }
    } catch (error) {
      systemLogger.error('Error loading rooms:', error);
      this.ensureStartingRoom(); // Make sure we have at least the starting room
    }
  }

  private saveRooms(): void {
    try {
      // Convert rooms to storable format (without players)
      const roomsData = Array.from(this.rooms.values()).map(room => {
        // Convert NPC Map to an array of template IDs for storage
        const npcTemplateIds: string[] = [];
        
        // For each NPC in the room, store its template ID
        room.npcs.forEach(npc => {
          npcTemplateIds.push(npc.templateId);
        });
        
        // Serialize item instances to a format suitable for storage
        const serializedItemInstances = room.serializeItemInstances();
        
        return {
          id: room.id,
          name: room.name,
          description: room.description,
          exits: room.exits,
          items: room.items, // Keep legacy items for backward compatibility
          itemInstances: serializedItemInstances, // Add new item instances
          npcs: npcTemplateIds,  // Use the array of template IDs
          currency: room.currency
        };
      });
      
      fs.writeFileSync(ROOMS_FILE, JSON.stringify(roomsData, null, 2));
    } catch (error) {
      systemLogger.error('Error saving rooms:', error);
    }
  }

  private ensureStartingRoom(): void {
    if (!this.rooms.has(DEFAULT_ROOM_ID)) {
      // Create a default starting room if none exists
      const startingRoom = new Room({
        id: DEFAULT_ROOM_ID,
        name: 'The Starting Room',
        description: 'You are in the starting room. It is small and musty and smells like old clothes and cheese.',
        exits: [{ direction: 'north', roomId: 'room2' }],
        items: ['sword', 'shield'],
        npcs: [],
        currency: { gold: 5, silver: 3, copper: 10 }
      });
      
      // Create a second room to demonstrate movement
      const secondRoom = new Room({
        id: 'room2',
        name: 'A New Room',
        description: 'You are in a new room.',
        exits: [{ direction: 'south', roomId: DEFAULT_ROOM_ID }],
        items: [],
        npcs: []
      });
      
      this.rooms.set(startingRoom.id, startingRoom);
      this.rooms.set(secondRoom.id, secondRoom);
      this.saveRooms();
    }
  }

  // Core room management methods
  public getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  public addRoomIfNotExists(room: Room): void {
    if (!this.rooms.has(room.id)) {
      this.rooms.set(room.id, room);
      this.saveRooms();
    }
  }

  public updateRoom(room: Room): void {
    this.rooms.set(room.id, room);
    this.saveRooms();
  }

  public getStartingRoomId(): string {
    return DEFAULT_ROOM_ID;
  }
  
  // Get all rooms (used by some systems like combat)
  public getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  // Service delegation methods - these delegate to specialized services
  
  // Movement methods
  public movePlayer(client: ConnectedClient, direction: string): boolean {
    return this.playerMovementService.movePlayer(client, direction);
  }

  public movePlayerWithDelay(client: ConnectedClient, direction: string): boolean {
    return this.playerMovementService.movePlayerWithDelay(client, direction);
  }
  
  // Entity methods
  public findClientByUsername(username: string): ConnectedClient | undefined {
    return this.entityRegistryService.findClientByUsername(username);
  }
  
  public getNPCFromRoom(roomId: string, npcId: string): NPC | null {
    return this.entityRegistryService.getNPCFromRoom(roomId, npcId);
  }
  
  public removeNPCFromRoom(roomId: string, npcInstanceId: string): boolean {
    return this.entityRegistryService.removeNPCFromRoom(roomId, npcInstanceId);
  }
  
  public storeNPC(npcId: string, npc: NPC): void {
    this.entityRegistryService.storeNPC(npcId, npc);
  }
  
  public lookAtEntity(client: ConnectedClient, entityName: string): boolean {
    return this.entityRegistryService.lookAtEntity(client, entityName);
  }
  
  // UI methods
  public lookRoom(client: ConnectedClient): boolean {
    return this.roomUINotificationService.lookRoom(client);
  }
  
  public briefLookRoom(client: ConnectedClient): boolean {
    return this.roomUINotificationService.briefLookRoom(client);
  }
  
  public notifyPlayersInRoom(roomId: string, message: string, excludeUsername?: string): void {
    this.roomUINotificationService.notifyPlayersInRoom(roomId, message, excludeUsername);
  }
  
  public announcePlayerEntrance(roomId: string, username: string): void {
    this.roomUINotificationService.announcePlayerEntrance(roomId, username);
  }
  
  // Teleportation methods
  public teleportToStartingRoom(client: ConnectedClient): boolean {
    return this.teleportationService.teleportToStartingRoom(client);
  }
  
  public teleportToStartingRoomIfNeeded(client: ConnectedClient): boolean {
    return this.teleportationService.teleportToStartingRoomIfNeeded(client);
  }
  
  public removePlayerFromAllRooms(username: string): void {
    this.teleportationService.removePlayerFromAllRooms(username);
  }

  // Direction helper methods
  public getOppositeDirection(direction: string): string {
    return this.directionHelper.getOppositeDirection(direction);
  }
  
  public getFullDirectionName(direction: string): string {
    return this.directionHelper.getFullDirectionName(direction);
  }

  /**
   * Force saving rooms data
   * Public method for tick system to call
   */
  public forceSave(): void {
    this.saveRooms();
  }

  /**
   * Get the CombatSystem instance (to avoid circular dependencies)
   */
  private getCombatSystem(): any {
    try {
      // Access the CombatSystem directly
      const { CombatSystem } = require('../combat/combatSystem');
      if (CombatSystem && CombatSystem.getInstance) {
        const { UserManager } = require('../user/userManager');
        return CombatSystem.getInstance(
          UserManager.getInstance(),
          this
        );
      }
      return null;
    } catch (err) {
      systemLogger.error('[RoomManager] Error getting CombatSystem instance:', err);
      return null;
    }
  }
}
