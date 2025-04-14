import { ConnectedClient } from '../../types';
import { CombatEntity } from '../combatEntity.interface';
import { EntityTracker } from './EntityTracker';
import { systemLogger, getPlayerLogger } from '../../utils/logger';
import { RoomManager } from '../../room/roomManager';
import { UserManager } from '../../user/userManager';
// Remove unused import
// import { NPC } from '../npc';
import { CombatNotifier } from './CombatNotifier';
import { formatUsername } from '../../utils/formatters';

/**
 * Responsible for processing attack logic and combat rounds
 */
export class CombatProcessor {
  // Current combat round
  private currentRound: number = 0;
  // Track the last combat round each entity attacked in
  private entityLastAttackRound: Map<string, number> = new Map();

  constructor(
    private entityTracker: EntityTracker,
    private combatNotifier: CombatNotifier,
    private userManager: UserManager,
    private roomManager: RoomManager
  ) {}

  /**
   * Process combat for all entities and players in a room
   * This will handle NPCs attacking players based on aggression
   */
  processRoomCombat(): void {
    // First scan all rooms for hostile NPCs and players
    this.scanRoomsForHostileNPCs();
    
    // Get all rooms with active combat entities
    const roomsWithCombat = new Set<string>();
    for (const roomId of this.getRoomsWithActiveEntities()) {
      roomsWithCombat.add(roomId);
    }
    
    // Add debug log for combat rooms
    systemLogger.debug(`Processing room combat for ${roomsWithCombat.size} rooms with combat entities`);
    
    // Process combat for each room with active combat entities
    for (const roomId of roomsWithCombat) {
      const entities = this.entityTracker.getCombatEntitiesInRoom(roomId);
      systemLogger.debug(`Processing room combat for room ${roomId} with ${entities.length} entities`);
      
      // Get the room to verify it exists
      const room = this.roomManager.getRoom(roomId);
      if (!room) {
        systemLogger.warn(`Room ${roomId} not found, skipping combat processing`);
        continue;
      }
      
      // Get all players in this room
      const playersInRoom = room.players;
      if (playersInRoom.length === 0) {
        systemLogger.debug(`Room ${roomId} has no players, skipping combat processing`);
        continue;
      }
      
      systemLogger.debug(`Room ${roomId} has ${playersInRoom.length} players: ${playersInRoom.join(', ')}`);
      
      // Process each entity in the room
      for (const entityName of entities) {
        const entityId = this.entityTracker.getEntityId(roomId, entityName);
        const entity = this.entityTracker.getSharedEntity(roomId, entityName);
        
        // Skip if entity doesn't exist or is already dead
        if (!entity || !entity.isAlive()) {
          systemLogger.info(`Entity ${entityName} in room ${roomId} is dead or missing, removing from combat`);
          this.entityTracker.removeEntityFromCombatForRoom(roomId, entityName);
          continue;
        }
        
        systemLogger.debug(`Processing entity ${entityName} in room ${roomId}, hostile: ${entity.isHostile}, passive: ${entity.isPassive}`);
        
        // Skip if entity has already attacked this round
        if (this.hasEntityAttackedThisRound(entityId)) {
          systemLogger.debug(`Entity ${entityName} in room ${roomId} has already attacked this round, skipping`);
          continue;
        }
        
        // Check if entity is hostile and should initiate combat
        if (entity.isHostile && !entity.isPassive) {
          // Get all players this entity has aggression against
          const aggressors = entity.getAllAggressors().filter(player => 
            playersInRoom.includes(player)
          );
          
          systemLogger.debug(`Entity ${entityName} has ${aggressors.length} aggressors in room ${roomId}`);
          
          // If there are aggressors in the room, pick one randomly to attack
          if (aggressors.length > 0) {
            const targetPlayerName = aggressors[Math.floor(Math.random() * aggressors.length)];
            const targetPlayer = this.findClientByUsername(targetPlayerName);
            
            if (targetPlayer && targetPlayer.user) {
              systemLogger.info(`Hostile NPC ${entityName} attacking aggressor ${targetPlayerName} in room ${roomId}`);
              const playerLogger = getPlayerLogger(targetPlayerName);
              playerLogger.info(`Hostile NPC ${entityName} is attacking you in room ${roomId}`);
              
              this.processNpcAttack(entity, targetPlayer, roomId);
              
              // Mark that this entity has attacked in this round
              this.markEntityAttacked(entityId);
            } else {
              systemLogger.debug(`Target player ${targetPlayerName} not found or invalid, skipping attack`);
            }
          }
          // If no specific aggressors but entity is hostile, target any player in the room
          else if (playersInRoom.length > 0) {
            // Select a random player from the room to attack
            const randomIndex = Math.floor(Math.random() * playersInRoom.length);
            const targetPlayerName = playersInRoom[randomIndex];
            const targetPlayer = this.findClientByUsername(targetPlayerName);
            
            if (targetPlayer && targetPlayer.user) {
              systemLogger.info(`Hostile NPC ${entityName} attacking random player ${targetPlayerName} in room ${roomId}`);
              const playerLogger = getPlayerLogger(targetPlayerName);
              playerLogger.info(`Hostile NPC ${entityName} is attacking you in room ${roomId}`);
              
              // Add aggression so future attacks prioritize this player
              entity.addAggression(targetPlayerName, 0);
              
              // Process the attack
              this.processNpcAttack(entity, targetPlayer, roomId);
              
              // Mark that this entity has attacked in this round
              this.markEntityAttacked(entityId);
            } else {
              systemLogger.debug(`Target player ${targetPlayerName} not found or invalid, skipping attack`);
            }
          }
        }
      }
    }
  }

  /**
   * Get all rooms with active combat entities
   */
  private getRoomsWithActiveEntities(): string[] {
    // Return the room IDs from the roomCombatEntities map in the EntityTracker
    const roomIds: string[] = [];
    
    // Access the internal roomCombatEntities map from entityTracker
    if (this.entityTracker['roomCombatEntities']) {
      for (const roomId of this.entityTracker['roomCombatEntities'].keys()) {
        roomIds.push(roomId);
      }
    }
    
    // Log how many rooms we found with active combat entities
    if (roomIds.length > 0) {
      systemLogger.debug(`Found ${roomIds.length} rooms with active combat entities: ${roomIds.join(', ')}`);
    }
    
    return roomIds;
  }

  /**
   * Process an attack from an NPC against a player
   */
  private processNpcAttack(npc: CombatEntity, player: ConnectedClient, roomId: string): void {
    if (!player.user) return;
    
    // 50% chance to hit
    const hit = Math.random() >= 0.5;
    
    if (hit) {
      const damage = npc.getAttackDamage();
      player.user.health -= damage;
      
      // Make sure it doesn't go below -10
      if (player.user.health < -10) player.user.health = -10;
      
      // Update the player's health
      this.userManager.updateUserStats(player.user.username, { health: player.user.health });
      
      // Send message to the targeted player and broadcast to room
      this.combatNotifier.notifyAttackResult(npc, player, roomId, true, damage);
      
      // Check if player died or became unconscious
      if (player.user.health <= 0) {
        this.handlePlayerDeath(player, roomId);
      }
    } else {
      // Send message to the targeted player and broadcast to room about the miss
      this.combatNotifier.notifyAttackResult(npc, player, roomId, false, 0);
    }
  }

  /**
   * Handle player death from an NPC attack
   */
  private handlePlayerDeath(player: ConnectedClient, roomId: string): void {
    if (!player.user) return;
    
    // Check if player is unconscious or fully dead
    const isFatallyDead = player.user.health <= -10;
    
    if (isFatallyDead) {
      // Player is fully dead (-10 HP or below)
      this.combatNotifier.notifyPlayerDeath(player, roomId);
      
      // Drop all inventory items where the player died
      this.dropPlayerInventory(player, roomId);
      
      // Teleport to starting room (respawn)
      this.teleportToStartingRoom(player);
    } else {
      // Player is unconscious (0 to -9 HP)
      this.combatNotifier.notifyPlayerUnconscious(player, roomId);
      
      // Mark player as unconscious
      player.user.isUnconscious = true;
      this.userManager.updateUserStats(player.user.username, { isUnconscious: true });
    }
  }

  /**
   * Drop player's inventory in the current room when they die
   */
  private dropPlayerInventory(player: ConnectedClient, roomId: string): void {
    if (!player.user || !player.user.inventory) return;
    
    const room = this.roomManager.getRoom(roomId);
    if (!room) return;
    
    // Drop all items
    if (player.user.inventory.items && player.user.inventory.items.length > 0) {
      const username = formatUsername(player.user.username);
      
      // Announce dropped items to the room
      const itemsList = player.user.inventory.items.join(', ');
      const dropMessage = `${username}'s corpse drops: ${itemsList}.\r\n`;
      this.combatNotifier.broadcastRoomMessage(roomId, dropMessage, 'cyan');
      
      // Add items to the room
      for (const item of player.user.inventory.items) {
        room.addItem(item);
      }
      
      // Clear player's inventory
      player.user.inventory.items = [];
    }
    
    // Transfer currency to the room
    if (player.user.inventory.currency) {
      const currency = player.user.inventory.currency;
      
      // Only announce/transfer if there's actual currency
      if (currency.gold > 0 || currency.silver > 0 || currency.copper > 0) {
        // Add currency to room
        room.currency.gold += currency.gold || 0;
        room.currency.silver += currency.silver || 0;
        room.currency.copper += currency.copper || 0;
        
        // Clear player's currency
        player.user.inventory.currency = { gold: 0, silver: 0, copper: 0 };
        
        // Announce currency drop to the room if there was any
        const username = formatUsername(player.user.username);
        const currencyText = this.formatCurrencyText(currency);
        if (currencyText) {
          const dropMessage = `${username}'s corpse drops ${currencyText}.\r\n`;
          this.combatNotifier.broadcastRoomMessage(roomId, dropMessage, 'cyan');
        }
      }
    }
    
    // Update the room
    this.roomManager.updateRoom(room);
    
    // Update the player's inventory in the database
    this.userManager.updateUserStats(player.user.username, { inventory: player.user.inventory });
  }
  
  /**
   * Format currency for display
   */
  private formatCurrencyText(currency: {gold?: number, silver?: number, copper?: number}): string {
    const parts = [];
    if (currency.gold && currency.gold > 0) parts.push(`${currency.gold} gold`);
    if (currency.silver && currency.silver > 0) parts.push(`${currency.silver} silver`);
    if (currency.copper && currency.copper > 0) parts.push(`${currency.copper} copper`);
    
    if (parts.length === 0) return '';
    return parts.join(', ');
  }
  
  /**
   * Teleport a player to the starting room
   */
  private teleportToStartingRoom(player: ConnectedClient): void {
    if (!player.user) return;
    
    const startingRoomId = this.roomManager.getStartingRoomId();
    const currentRoomId = player.user.currentRoomId;
    
    if (currentRoomId) {
      // Remove from current room
      const currentRoom = this.roomManager.getRoom(currentRoomId);
      if (currentRoom) {
        currentRoom.removePlayer(player.user.username);
        this.roomManager.updateRoom(currentRoom);
      }
    }
    
    // Add to starting room
    const startingRoom = this.roomManager.getRoom(startingRoomId);
    if (startingRoom) {
      startingRoom.addPlayer(player.user.username);
      this.roomManager.updateRoom(startingRoom);
      
      // Update player's current room
      player.user.currentRoomId = startingRoomId;
      
      // Restore player to full health
      player.user.health = player.user.maxHealth;
      
      // Clear the unconscious state
      player.user.isUnconscious = false;
      
      // Update the user stats all at once
      this.userManager.updateUserStats(player.user.username, { 
        currentRoomId: startingRoomId,
        health: player.user.maxHealth,
        isUnconscious: false
      });
      
      // Show the starting room to the player
      this.combatNotifier.notifyPlayerTeleported(player, startingRoom);
    }
  }

  /**
   * Scan all rooms for hostile NPCs and players in the same room
   * This ensures hostile NPCs will attack players even if the players
   * were already in the room before the NPC spawned
   */
  private scanRoomsForHostileNPCs(): void {
    systemLogger.debug(`Scanning all rooms for hostile NPCs and players`);
    
    // Get all rooms from the room manager
    const rooms = this.roomManager.getAllRooms();
    
    // Add more detailed logging for hostile NPCs
    systemLogger.info(`Scanning rooms for hostile NPCs and players - found ${rooms.length} total rooms`);
    let hostileNpcsFound = 0;
    
    for (const room of rooms) {
      // Skip rooms with no NPCs or no players
      if (!room.npcs || room.npcs.size === 0 || !room.players || room.players.length === 0) {
        continue;
      }
      
      let hostileNpcsInRoom = 0;
      
      // Check for hostile NPCs in this room
      for (const [npcId, npc] of room.npcs.entries()) {
        // Get entity to check its hostility - use the npc instance from the map
        const entity = npc;
        
        if (entity && entity.isHostile) {
          hostileNpcsFound++;
          hostileNpcsInRoom++;
          systemLogger.info(`Found hostile NPC ${npc.name} (${npcId}) in room ${room.id} with ${room.players.length} players: ${room.players.join(', ')}`);
          
          // Add the entity to active combat entities for this room if not already
          if (!this.entityTracker.isEntityInCombat(room.id, npcId)) {
            this.entityTracker.addEntityToCombatForRoom(room.id, npcId);
            systemLogger.info(`Added hostile NPC ${npc.name} (${npcId}) to combat in room ${room.id}`);
          }
          
          // Generate an entity ID for tracking
          const entityId = this.entityTracker.getEntityId(room.id, npcId);
          
          // For each player in the room, ensure they're on the NPC's aggression list
          for (const playerName of room.players) {
            if (!entity.hasAggression(playerName)) {
              systemLogger.info(`Adding player ${playerName} to aggression list of ${npc.name} in room ${room.id}`);
              const playerLogger = getPlayerLogger(playerName);
              playerLogger.info(`Hostile NPC ${npc.name} is now aware of your presence in room ${room.id}`);
              
              // Add aggression with 0 damage to indicate awareness rather than damage dealt
              entity.addAggression(playerName, 0);
            }
          }
        }
      }
      
      if (hostileNpcsInRoom > 0) {
        systemLogger.info(`Room ${room.id} has ${hostileNpcsInRoom} hostile NPCs and ${room.players.length} players`);
      }
    }
    
    if (hostileNpcsFound > 0) {
      systemLogger.info(`Found a total of ${hostileNpcsFound} hostile NPCs across all rooms`);
    } else {
      systemLogger.info(`No hostile NPCs found in any rooms with players`);
    }
  }

  /**
   * Increment the global combat round
   */
  processCombatRound(): void {
    this.currentRound++;
    systemLogger.debug(`Processing combat round ${this.currentRound}`);
    
    // Clear entity attack status for the new round
    this.entityLastAttackRound.clear();
  }

  /**
   * Check if an entity has already attacked in this round
   */
  hasEntityAttackedThisRound(entityId: string): boolean {
    return this.entityLastAttackRound.get(entityId) === this.currentRound;
  }

  /**
   * Mark that an entity has attacked in this round
   */
  markEntityAttacked(entityId: string): void {
    this.entityLastAttackRound.set(entityId, this.currentRound);
  }

  /**
   * Reset entity attack status so it can attack again immediately
   * Used when its current target disconnects
   */
  resetEntityAttackStatus(entityId: string): void {
    if (this.entityLastAttackRound.has(entityId)) {
      this.entityLastAttackRound.delete(entityId);
    }
  }

  /**
   * Get the current combat round
   */
  getCurrentRound(): number {
    return this.currentRound;
  }

  /**
   * Find a client by username
   */
  findClientByUsername(username: string): ConnectedClient | undefined {
    for (const client of this.roomManager['clients'].values()) {
      if (client.user && client.user.username.toLowerCase() === username.toLowerCase()) {
        return client;
      }
    }
    return undefined;
  }

  /**
   * Find all clients with the same username
   * Used during session transfers to ensure we don't prematurely end combat
   */
  findAllClientsByUsername(username: string): ConnectedClient[] {
    const results: ConnectedClient[] = [];
    for (const client of this.roomManager['clients'].values()) {
      if (client.user && client.user.username.toLowerCase() === username.toLowerCase()) {
        results.push(client);
      }
    }
    return results;
  }
}