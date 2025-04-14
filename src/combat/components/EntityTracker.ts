import { CombatEntity } from '../combatEntity.interface';
import { systemLogger } from '../../utils/logger';
import { NPC } from '../npc';
import { RoomManager } from '../../room/roomManager';

/**
 * Responsible for tracking entities across rooms and managing entity targeting
 */
export class EntityTracker {
  // Map of roomId -> Map of entityName -> CombatEntity
  private sharedEntities: Map<string, Map<string, CombatEntity>> = new Map();
  // Track which entities should be in active combat per room
  private roomCombatEntities: Map<string, Set<string>> = new Map();
  // Track which players are targeting which entities (entityId -> Set of usernames)
  private entityTargeters: Map<string, Set<string>> = new Map();

  constructor(private roomManager: RoomManager) {}

  /**
   * Add an entity to the active combat entities for a room
   */
  addEntityToCombatForRoom(roomId: string, entityName: string): void {
    if (!this.roomCombatEntities.has(roomId)) {
      this.roomCombatEntities.set(roomId, new Set());
    }
    this.roomCombatEntities.get(roomId)!.add(entityName);
    systemLogger.info(`Added ${entityName} to active combat in room ${roomId}`);
  }

  /**
   * Remove an entity from active combat entities for a room
   */
  removeEntityFromCombatForRoom(roomId: string, entityName: string): void {
    if (this.roomCombatEntities.has(roomId)) {
      this.roomCombatEntities.get(roomId)!.delete(entityName);
      systemLogger.info(`Removed ${entityName} from active combat in room ${roomId}`);
      
      // Clean up if no more combat entities in this room
      if (this.roomCombatEntities.get(roomId)!.size === 0) {
        this.roomCombatEntities.delete(roomId);
      }
    }
  }

  /**
   * Get all active combat entities in a room
   */
  getCombatEntitiesInRoom(roomId: string): string[] {
    if (!this.roomCombatEntities.has(roomId)) {
      return [];
    }
    return Array.from(this.roomCombatEntities.get(roomId)!);
  }

  /**
   * Check if an entity is in active combat in a room
   */
  isEntityInCombat(roomId: string, entityName: string): boolean {
    return this.roomCombatEntities.has(roomId) && 
           this.roomCombatEntities.get(roomId)!.has(entityName);
  }

  /**
   * Get or create a shared entity for a room
   */
  getSharedEntity(roomId: string, entityName: string): CombatEntity | null {
    if (!this.sharedEntities.has(roomId)) {
      this.sharedEntities.set(roomId, new Map());
    }
    const roomEntities = this.sharedEntities.get(roomId)!;
    
    // Try to find an existing entity
    if (roomEntities.has(entityName)) {
      const existingEntity = roomEntities.get(entityName)!;
      if (!existingEntity.isAlive()) {
        // Remove if dead, then recreate
        roomEntities.delete(entityName);
      } else {
        return existingEntity;
      }
    }
    
    // Look up entity in the room
    const room = this.roomManager.getRoom(roomId);
    if (!room) return null;
    
    // First try to find the NPC by instance ID directly
    let npc: NPC | null = room.npcs.get(entityName) || null;
    
    // If not found by instance ID, check if entityName might be a template ID
    if (!npc && room.npcs) {
      const matchingNPCs = Array.from(room.npcs.values()).filter((n: NPC) => n.templateId === entityName);
      if (matchingNPCs.length > 0) {
        npc = matchingNPCs[0];
        
        // Create a mapping from template ID to the instance we're using
        if (npc.instanceId !== entityName) {
          systemLogger.info(`Creating mapping from template ID ${entityName} to instance ID ${npc.instanceId}`);
          
          // Store by instance ID instead
          if (!roomEntities.has(npc.instanceId)) {
            roomEntities.set(npc.instanceId, npc);
          }
          
          // Return the entity we found by template ID
          return npc;
        }
      }
    }
    
    // If we still don't have an NPC, create a placeholder
    if (!npc) {
      npc = this.createTestNPC(entityName);
    }
    
    roomEntities.set(entityName, npc);
    return npc;
  }

  /**
   * Create a test NPC for development - will be replaced with proper NPC loading
   */
  public createTestNPC(name: string = 'cat'): NPC {
    // Load NPC data from JSON file to set proper hostility values
    const npcData = NPC.loadNPCData();
    
    // Check if we have data for this NPC
    if (npcData.has(name)) {
      systemLogger.debug(`Creating NPC ${name} from data`);
      return NPC.fromNPCData(npcData.get(name)!);
    }
    
    // Fallback to default NPC if no data found
    systemLogger.warn(`No data found for NPC ${name}, creating default`);
    return new NPC(
      name,
      20,  // health
      20,  // maxHealth
      [1, 3],  // damage range
      false,  // isHostile
      false,  // isPassive
      100  // experienceValue
    );
  }

  /**
   * Clean up a dead entity
   */
  cleanupDeadEntity(roomId: string, entityName: string): void {
    if (this.sharedEntities.has(roomId)) {
      const roomEntities = this.sharedEntities.get(roomId)!;
      if (roomEntities.has(entityName)) {
        roomEntities.delete(entityName);
      }
    }
  }

  /**
   * Track which players are targeting an entity
   */
  trackEntityTargeter(entityId: string, username: string): void {
    if (!this.entityTargeters.has(entityId)) {
      this.entityTargeters.set(entityId, new Set());
    }
    
    this.entityTargeters.get(entityId)!.add(username);
  }

  /**
   * Get all players targeting a specific entity
   */
  getEntityTargeters(entityId: string): string[] {
    if (!this.entityTargeters.has(entityId)) {
      return [];
    }
    
    return Array.from(this.entityTargeters.get(entityId)!);
  }

  /**
   * Remove a player from targeting an entity
   */
  removeEntityTargeter(entityId: string, username: string): void {
    if (this.entityTargeters.has(entityId)) {
      this.entityTargeters.get(entityId)!.delete(username);
      
      // Clean up if no more targeters
      if (this.entityTargeters.get(entityId)!.size === 0) {
        this.entityTargeters.delete(entityId);
      }
    }
  }

  /**
   * Check if an entity has been killed
   */
  entityIsDead(entityId: string): boolean {
    // Parse the entity ID to get room and name
    const [roomId] = entityId.split('::');
    
    if (!this.sharedEntities.has(roomId)) {
      return true;
    }
    
    const roomEntities = this.sharedEntities.get(roomId)!;
    // Extract the entity name from the ID
    const entityName = entityId.split('::')[1];
    if (!roomEntities.has(entityName)) {
      return true;
    }
    
    return !roomEntities.get(entityName)!.isAlive();
  }

  /**
   * Get a unique ID for an entity in a room
   */
  getEntityId(roomId: string, entityName: string): string {
    return `${roomId}::${entityName}`;
  }
}