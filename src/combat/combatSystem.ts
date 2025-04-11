import { ConnectedClient } from '../types';
import { Combat } from './combat';
import { CombatEntity } from './combatEntity.interface';
import { colorize, ColorType } from '../utils/colors';
import { writeFormattedMessageToClient, drawCommandPrompt, writeToClient } from '../utils/socketWriter';
import { UserManager } from '../user/userManager';
import { NPC } from './npc';
import { RoomManager } from '../room/roomManager';
import { formatUsername } from '../utils/formatters';

export class CombatSystem {
  private static instance: CombatSystem | null = null;
  private combats: Map<string, Combat> = new Map();
  // Track entities by room ID and name to share them across players
  private sharedEntities: Map<string, Map<string, CombatEntity>> = new Map();
  // Track which players are targeting which entities
  private entityTargeters: Map<string, Set<string>> = new Map();
  // Track the last combat round each entity attacked in
  private entityLastAttackRound: Map<string, number> = new Map();
  // Track which entities have already attacked in the current round
  private entitiesAttackedThisRound: Set<string> = new Set();
  // NEW: Track entities that should be in active combat per room
  private roomCombatEntities: Map<string, Set<string>> = new Map();
  // Current combat round
  private currentRound: number = 0;
  
  constructor(
    private userManager: UserManager,
    private roomManager: RoomManager
  ) {}

  /**
   * Get the singleton instance of CombatSystem
   */
  public static getInstance(userManager: UserManager, roomManager: RoomManager): CombatSystem {
    if (!CombatSystem.instance) {
      CombatSystem.instance = new CombatSystem(userManager, roomManager);
    }
    return CombatSystem.instance;
  }

  /**
   * Add an entity to the active combat entities for a room
   */
  private addEntityToCombatForRoom(roomId: string, entityName: string): void {
    if (!this.roomCombatEntities.has(roomId)) {
      this.roomCombatEntities.set(roomId, new Set());
    }
    this.roomCombatEntities.get(roomId)!.add(entityName);
    console.log(`[CombatSystem] Added ${entityName} to active combat in room ${roomId}`);
  }

  /**
   * Remove an entity from active combat entities for a room
   */
  private removeEntityFromCombatForRoom(roomId: string, entityName: string): void {
    if (this.roomCombatEntities.has(roomId)) {
      this.roomCombatEntities.get(roomId)!.delete(entityName);
      console.log(`[CombatSystem] Removed ${entityName} from active combat in room ${roomId}`);
      
      // Clean up if no more combat entities in this room
      if (this.roomCombatEntities.get(roomId)!.size === 0) {
        this.roomCombatEntities.delete(roomId);
      }
    }
  }

  /**
   * Get all active combat entities in a room
   */
  private getCombatEntitiesInRoom(roomId: string): string[] {
    if (!this.roomCombatEntities.has(roomId)) {
      return [];
    }
    return Array.from(this.roomCombatEntities.get(roomId)!);
  }

  /**
   * Check if an entity is in active combat in a room
   */
  private isEntityInCombat(roomId: string, entityName: string): boolean {
    return this.roomCombatEntities.has(roomId) && 
           this.roomCombatEntities.get(roomId)!.has(entityName);
  }

  /**
   * Get or create a shared entity for a room
   */
  private getSharedEntity(roomId: string, entityName: string): CombatEntity | null {
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
    
    // Verify the NPC is actually in this room
    if (!room.npcs.includes(entityName)) {
      console.log(`[CombatSystem] NPC ${entityName} not found in room ${roomId}`);
      return null;
    }
    
    // Create a new NPC instance
    const npc = this.createTestNPC(entityName);
    
    roomEntities.set(entityName, npc);
    return npc;
  }

  /**
   * Track which players are targeting an entity
   */
  private trackEntityTargeter(entityId: string, username: string): void {
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

  /**
   * Engage a player in combat with a target
   */
  engageCombat(player: ConnectedClient, target: CombatEntity): boolean {
    if (!player.user || !player.user.currentRoomId) return false;

    const roomId = player.user.currentRoomId;
    const entityId = this.getEntityId(roomId, target.name);
    
    const sharedTarget = this.getSharedEntity(roomId, target.name);
    if (!sharedTarget) return false;
    
    // Check if player is already in combat with a different NPC
    let combat = this.combats.get(player.user.username);
    if (combat && combat.activeCombatants.length > 0) {
      // Allow switching to a new target - clear old targets first
      combat.activeCombatants = [];
      
      // Log the target switch
      console.log(`[CombatSystem] Player ${player.user.username} switched target to ${target.name}`);
      
      // Notify player
      writeFormattedMessageToClient(
        player,
        colorize(`You turn your attention to ${target.name}.\r\n`, 'yellow')
      );
    }
    
    // Track that the player is targeting this entity
    this.trackEntityTargeter(entityId, player.user.username);
    
    // Add the entity to active combat entities for this room
    this.addEntityToCombatForRoom(roomId, target.name);
    
    // Note: We don't add aggression here anymore - aggression is only added when damage is dealt
    // or an attack is attempted and misses in the processAttack method

    // If a combat instance exists but the player's inCombat flag is off, re-engage combat
    if (combat && !player.user.inCombat) {
      console.log(`[CombatSystem] Re-engaging combat for ${player.user.username}`);
      player.user.inCombat = true;
      this.userManager.updateUserStats(player.user.username, { inCombat: true });
      writeToClient(player, colorize(`*Combat Engaged*\r\n`, 'boldYellow'));
      drawCommandPrompt(player);
    }
    
    // If no combat instance exists, create a new one.
    if (!combat) {
      combat = new Combat(player, this.userManager, this.roomManager, this);
      this.combats.set(player.user.username, combat);
      
      player.user.inCombat = true;
      this.userManager.updateUserStats(player.user.username, { inCombat: true });
      const clearLineSequence = '\r\x1B[K';
      writeToClient(player, clearLineSequence);
      writeToClient(player, colorize(`*Combat Engaged*\r\n`, 'boldYellow'));
      drawCommandPrompt(player);
      this.broadcastCombatStart(player, sharedTarget);
    }
    
    combat.addTarget(sharedTarget);
    
    return true;
  }

  /**
   * Broadcast combat start to other players in the room
   */
  private broadcastCombatStart(player: ConnectedClient, target: CombatEntity): void {
    if (!player.user || !player.user.currentRoomId) return;
    
    const room = this.roomManager.getRoom(player.user.currentRoomId);
    if (!room) return;
    
    const username = formatUsername(player.user.username);
    // Don't add extra line breaks - they will be handled by the writeMessageToClient function
    const message = colorize(`${username} moves to attack ${target.name}!\r\n`, 'boldYellow');
    
    for (const playerName of room.players) {
      // Skip the player who started combat
      if (playerName === player.user.username) continue;
      
      // Find client for this player
      const client = this.findClientByUsername(playerName);
      if (client) {
        writeFormattedMessageToClient(client, message);
      }
    }
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

  /**
   * Process combat rounds for all active combats
   */
  processCombatRound(): void {
    // Increment the global combat round
    this.currentRound++;
    
    console.log(`[CombatSystem] Processing combat round ${this.currentRound} for ${this.combats.size} active combats`);
    
    // Clear the list of entities that have attacked this round
    this.entitiesAttackedThisRound.clear();
    
    // First check for disconnected players and end their combat
    const playersToRemove: string[] = [];
    
    for (const [username, combat] of this.combats.entries()) {
      // Check if player is still connected
      const client = this.findClientByUsername(username);
      
      // ROBUSTNESS FIX: Only end combat if really disconnected
      // Add timeout check to handle temporary disconnects during transfers
      const currentTime = Date.now();
      const MAX_INACTIVE_TIME = 10000; // 10 seconds grace period
      
      if ((!client || !client.authenticated || !client.user) &&
          (!combat.lastActivityTime || currentTime - combat.lastActivityTime > MAX_INACTIVE_TIME)) {
        console.log(`[CombatSystem] Player ${username} is no longer valid, marking for removal`);
        // Player is no longer valid, mark for removal
        playersToRemove.push(username);
        continue;
      }
      
      // CRITICAL: Ensure player reference is updated
      if (client && client.user && client !== combat.player) {
        console.log(`[CombatSystem] Updating combat player reference for ${username}`);
        combat.updateClientReference(client);
      }
      
      console.log(`[CombatSystem] Processing combat for ${username} with ${combat.activeCombatants.length} combatants`);
      
      // Update last activity time
      combat.lastActivityTime = currentTime;
      
      // Set the current round on the combat instance
      combat.currentRound = this.currentRound;
      combat.processRound();
      
      // Check if combat is done
      if (combat.isDone()) {
        console.log(`[CombatSystem] Combat for ${username} is done, cleaning up`);
        combat.endCombat();
        playersToRemove.push(username);
      }
    }
    
    // Clean up any combats that are done or have disconnected players
    for (const username of playersToRemove) {
      console.log(`[CombatSystem] Removing combat for ${username}`);
      this.combats.delete(username);
      
      // Clean up entity targeters for this player
      for (const [entityId, targeters] of this.entityTargeters.entries()) {
        targeters.delete(username);
        if (targeters.size === 0) {
          this.entityTargeters.delete(entityId);
        }
      }
    }
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
   * Broadcast a message to all players in a room regarding combat
   */
  broadcastRoomCombatMessage(
    roomId: string, 
    message: string, 
    color: ColorType = 'boldYellow', 
    excludeUsername?: string
  ): void {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return;

    const formattedMessage = colorize(message, color as any);
    
    for (const playerName of room.players) {
      // Skip excluded player if specified
      if (excludeUsername && playerName === excludeUsername) continue;
      
      const client = this.findClientByUsername(playerName);
      if (client) {
        writeFormattedMessageToClient(client, formattedMessage);
      }
    }
  }

  /**
   * Attempt to break combat for a player
   */
  breakCombat(player: ConnectedClient): boolean {
    if (!player.user) return false;
    
    const combat = this.combats.get(player.user.username);
    if (!combat) return false;
    
    // Set player's inCombat to false, but do not end the combat.
    player.user.inCombat = false;
    this.userManager.updateUserStats(player.user.username, { inCombat: false });
    
    writeFormattedMessageToClient(
      player,
      colorize(`*Combat Off*\r\n`, 'boldYellow')
    );
    
    // Broadcast to room with proper line handling
    if (player.user && player.user.currentRoomId) {
      const room = this.roomManager.getRoom(player.user.currentRoomId);
      if (room) {
        const username = formatUsername(player.user.username);
        const message = colorize(`${username} attempts to break combat...\r\n`, 'boldYellow');
        
        for (const playerName of room.players) {
          // Skip the player who is breaking combat
          if (playerName === player.user.username) continue;
          
          // Find client for this player
          const client = this.findClientByUsername(playerName);
          if (client) {
            writeFormattedMessageToClient(client, message);
          }
        }
      }
    }
    
    return true;
  }

  /**
   * Check if a player is in combat
   */
  isInCombat(player: ConnectedClient): boolean {
    if (!player.user) return false;
    return this.combats.has(player.user.username);
  }

  /**
   * Create a test NPC for development
   */
  createTestNPC(name: string = 'cat'): NPC {
    // Load NPC data from JSON file to set proper hostility values
    const npcData = NPC.loadNPCData();
    
    // Check if we have data for this NPC
    if (npcData.has(name)) {
      console.log(`[CombatSystem] Creating NPC ${name} from data`);
      return NPC.fromNPCData(npcData.get(name)!);
    }
    
    // Fallback to default NPC if no data found
    console.log(`[CombatSystem] No data found for NPC ${name}, creating default`);
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
   * Manually remove combat for a player
   * Used when an entity dies and we need to end combat for all targeting players
   */
  removeCombatForPlayer(username: string): void {
    // Remove the combat instance for this player
    this.combats.delete(username);
  }

  /**
   * Handle a player disconnecting
   */
  public handlePlayerDisconnect(player: ConnectedClient): void {
    if (!player.user) return;
    
    const username = player.user.username;
    const roomId = player.user.currentRoomId;
    
    // End the player's combat
    const combat = this.combats.get(username);
    if (combat) {
      // Remove combat for the player
      this.combats.delete(username);
      
      // Notify others in the room that the player is no longer in combat
      if (roomId) {
        const formattedUsername = formatUsername(username);
        this.broadcastRoomCombatMessage(
          roomId,
          `${formattedUsername} is no longer in combat (disconnected).\r\n`,
          'yellow',
          username
        );
      }
    }
    
    // Track which entities this player was targeting
    const targetedEntities: string[] = [];
    
    // Remove player from all entity targeters and collect entities
    for (const [entityId, targeters] of this.entityTargeters.entries()) {
      if (targeters.has(username)) {
        targetedEntities.push(entityId);
        this.removeEntityTargeter(entityId, username);
      }
    }
    
    // Check each entity to see if it needs to select a new target
    for (const entityId of targetedEntities) {
      // Parse the entity ID to get room and name
      const [entityRoomId, entityName] = entityId.split('::');
      
      if (entityRoomId !== roomId) continue;
      
      // Get remaining targeters for this entity
      const remainingTargeters = this.getEntityTargeters(entityId);
      
      // If there are still players targeting this entity, make sure the entity
      // targets one of them in the next combat round
      if (remainingTargeters.length > 0) {
        this.resetEntityAttackStatus(entityId);
      }
    }
    
    // Update player's inCombat status before they disconnect
    player.user.inCombat = false;
    this.userManager.updateUserStats(username, { inCombat: false });
  }

  /**
   * Handle a session transfer for a player in combat
   * Makes sure the combat continues with the new client
   */
  public handleSessionTransfer(oldClient: ConnectedClient, newClient: ConnectedClient): void {
    if (!oldClient.user || !newClient.user) return;
    
    const username = oldClient.user.username;
    console.log(`[CombatSystem] Handling session transfer for ${username}`);
    
    // Mark the transfer in progress to prevent combat from ending prematurely
    if (oldClient.stateData) {
      oldClient.stateData.transferInProgress = true;
    }
    if (newClient.stateData) {
      newClient.stateData.isSessionTransfer = true;
    }
    
    // CRITICAL FIX: Always preserve the inCombat flag
    const inCombat = oldClient.user.inCombat;
    if (inCombat) {
      console.log(`[CombatSystem] User ${username} is in combat, preserving combat state`);
      newClient.user.inCombat = true;
      this.userManager.updateUserStats(username, { inCombat: true });
      
      // Get existing combat instance
      let combat = this.combats.get(username);
      
      if (combat) {
        console.log(`[CombatSystem] Found existing combat instance for ${username}`);
        
        // IMPORTANT - Clone info from old combat before updating reference
        const activeCombatantsCopy = [...combat.activeCombatants];
        
        // Update the combat instance with the new client reference
        combat.updateClientReference(newClient);
        
        // Verify active combatants are still present after reference update
        if (combat.activeCombatants.length === 0 && activeCombatantsCopy.length > 0) {
          console.log(`[CombatSystem] Warning: Lost combatants during reference update, restoring`);
          combat.activeCombatants = activeCombatantsCopy;
        }
      } else {
        // No existing combat found but user is in combat - recreate it
        console.log(`[CombatSystem] No combat instance found but user ${username} has inCombat flag, recreating`);
        combat = new Combat(newClient, this.userManager, this.roomManager, this);
        
        // Add stronger reference binding to prevent it from being garbage collected
        newClient.stateData.combatInstance = combat;
        
        // Store in the combats map
        this.combats.set(username, combat);
        
        // If in a room, add a target
        if (newClient.user.currentRoomId) {
          const room = this.roomManager.getRoom(newClient.user.currentRoomId);
          if (room && room.npcs.length > 0) {
            // Force recreation of combat with the first NPC in the room
            const npcName = room.npcs[0];
            const npc = this.getSharedEntity(newClient.user.currentRoomId, npcName);
            if (npc) {
              combat.addTarget(npc);
              const entityId = this.getEntityId(newClient.user.currentRoomId, npcName);
              this.trackEntityTargeter(entityId, username);
              console.log(`[CombatSystem] Added ${npcName} as target for ${username} during transfer recreation`);
              
              // Reset NPC attack state to prevent immediate attack
              this.resetEntityAttackStatus(entityId);
            }
          }
        }
      }
      
      // Always notify the player they're still in combat
      writeToClient(newClient, colorize('\r\nCombat state transferred. You are still in combat!\r\n', 'boldYellow'));
      
      // CRITICAL FIX: Make sure the client's UI state shows they're in combat
      // This ensures the prompt will show [COMBAT] and player can continue combat
      if (combat && combat.activeCombatants.length > 0) {
        // Force the combat prompt to appear by explicitly setting inCombat
        const clearLineSequence = '\r\x1B[K';
        writeToClient(newClient, clearLineSequence);
        
        // This draws the [COMBAT] prompt properly
        drawCommandPrompt(newClient);
        
        // Skip the next NPC attack to prevent double attacking
        // This fixes the issue of NPC attacking right after transfer but player not getting a turn
        for (const combatant of combat.activeCombatants) {
          const entityId = this.getEntityId(newClient.user.currentRoomId, combatant.name);
          this.markEntityAttacked(entityId);
        }
        
        // Add a timestamp to track last activity
        combat.lastActivityTime = Date.now();
      }
    } else {
      console.log(`[CombatSystem] User ${username} is not in combat, nothing to transfer`);
      newClient.user.inCombat = false;
    }
    
    // Remove the transfer in progress flag after a delay
    setTimeout(() => {
      if (oldClient.stateData) {
        delete oldClient.stateData.transferInProgress;
      }
    }, 10000);
  }

  /**
   * Track player movement between rooms without immediately ending combat
   * Combat will end during the next combat tick if the player and targets
   * are not in the same room.
   */
  public handlePlayerMovedRooms(player: ConnectedClient): void {
    if (!player.user) return;
    
    const username = player.user.username;
    console.log(`[CombatSystem] Player ${username} moved rooms while in combat. Combat will continue until next tick checks positions.`);
    
    // We intentionally don't end combat here, allowing the player to move freely
    // The combat system's processRound() will handle ending combat during the next tick
    // if the player and target are not in the same room
  }

  /**
   * Process combat for all entities and players in a room
   * This will handle NPCs attacking players based on aggression
   */
  processRoomCombat(): void {
    // ENHANCEMENT: First scan all rooms for hostile NPCs and players
    this.scanRoomsForHostileNPCs();
    
    // Process combat for each room with active combat entities
    for (const [roomId, entities] of this.roomCombatEntities.entries()) {
      console.log(`[CombatSystem] Processing room combat for room ${roomId} with ${entities.size} entities`);
      
      // Get the room to verify it exists
      const room = this.roomManager.getRoom(roomId);
      if (!room) {
        console.log(`[CombatSystem] Room ${roomId} not found, skipping combat processing`);
        continue;
      }
      
      // Get all players in this room
      const playersInRoom = room.players;
      
      // Process each entity in the room
      for (const entityName of entities) {
        const entityId = this.getEntityId(roomId, entityName);
        const entity = this.getSharedEntity(roomId, entityName);
        
        // Skip if entity doesn't exist or is already dead
        if (!entity || !entity.isAlive()) {
          console.log(`[CombatSystem] Entity ${entityName} in room ${roomId} is dead or missing, removing from combat`);
          this.removeEntityFromCombatForRoom(roomId, entityName);
          continue;
        }
        
        // Skip if entity has already attacked this round
        if (this.hasEntityAttackedThisRound(entityId)) {
          continue;
        }
        
        // Check if entity is hostile and should initiate combat
        if (entity.isHostile) {
          // Get all players this entity has aggression against
          const aggressors = entity.getAllAggressors().filter(player => 
            playersInRoom.includes(player)
          );
          
          // If there are aggressors in the room, pick one randomly to attack
          if (aggressors.length > 0) {
            const targetPlayerName = aggressors[Math.floor(Math.random() * aggressors.length)];
            const targetPlayer = this.findClientByUsername(targetPlayerName);
            
            if (targetPlayer && targetPlayer.user) {
              this.processNpcAttack(entity, targetPlayer, roomId);
              
              // Mark that this entity has attacked in this round
              this.markEntityAttacked(entityId);
            }
          }
          // New code: If no specific aggressors but entity is hostile, target any player in the room
          else if (playersInRoom.length > 0) {
            // Select a random player from the room to attack
            const randomIndex = Math.floor(Math.random() * playersInRoom.length);
            const targetPlayerName = playersInRoom[randomIndex];
            const targetPlayer = this.findClientByUsername(targetPlayerName);
            
            if (targetPlayer && targetPlayer.user) {
              console.log(`[CombatSystem] Hostile NPC ${entityName} attacking player ${targetPlayerName} without prior aggression`);
              
              // Add aggression so future attacks prioritize this player
              entity.addAggression(targetPlayerName, 0);
              
              // Process the attack
              this.processNpcAttack(entity, targetPlayer, roomId);
              
              // Mark that this entity has attacked in this round
              this.markEntityAttacked(entityId);
              
              // If the player isn't already in combat, engage them in combat
              if (!targetPlayer.user.inCombat) {
                this.engageCombat(targetPlayer, entity);
              }
            }
          }
        }
      }
    }
  }
  
  /**
   * Process an attack from an NPC against a player
   */
  private processNpcAttack(npc: CombatEntity, player: ConnectedClient, roomId: string): void {
    if (!player.user) return;
    
    // 50% chance to hit
    const hit = Math.random() >= 0.5;
    
    // Format the target name for messages
    const targetNameFormatted = formatUsername(player.user.username);
    
    if (hit) {
      const damage = npc.getAttackDamage();
      player.user.health -= damage;
      
      // NO LONGER limit health to 0! Allow it to go negative up to -10
      // Make sure it doesn't go below -10
      if (player.user.health < -10) player.user.health = -10;
      
      // Update the player's health
      this.userManager.updateUserStats(player.user.username, { health: player.user.health });
      
      // Send message to the targeted player
      writeFormattedMessageToClient(
        player,
        colorize(`The ${npc.name} ${npc.getAttackText('you')} for ${damage} damage.\r\n`, 'red')
      );
      
      // Broadcast to ALL players in room except the target
      this.broadcastRoomCombatMessage(
        roomId,
        `The ${npc.name} ${npc.getAttackText(targetNameFormatted)} for ${damage} damage.\r\n`,
        'red' as ColorType,
        player.user.username
      );
      
      // Check if player died or became unconscious
      if (player.user.health <= 0) {
        this.handlePlayerDeath(player, roomId);
      }
    } else {
      // Send message to the targeted player about the miss
      writeFormattedMessageToClient(
        player,
        colorize(`The ${npc.name} ${npc.getAttackText('you')} and misses!\r\n`, 'cyan')
      );
      
      // Broadcast to ALL players in room except the target
      this.broadcastRoomCombatMessage(
        roomId,
        `The ${npc.name} ${npc.getAttackText(targetNameFormatted)} and misses!\r\n`,
        'cyan' as ColorType,
        player.user.username
      );
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
      // Send death message to player
      writeFormattedMessageToClient(
        player,
        colorize(`You have died! Your body will be transported to the starting area.\r\n`, 'red')
      );
      
      // Drop all inventory items where the player died
      this.dropPlayerInventory(player, roomId);
      
      // Broadcast to others using the default boldYellow for status messages
      const username = formatUsername(player.user.username);
      const message = `${username} has died!\r\n`;
      
      // Broadcast to all other players in the room
      this.broadcastRoomCombatMessage(roomId, message, 'boldYellow', player.user.username);
      
      // Teleport to starting room (respawn)
      this.teleportToStartingRoom(player);
      
      // Restore health to 50% of max 
      player.user.health = Math.floor(player.user.maxHealth * 0.5);
      this.userManager.updateUserStats(player.user.username, { health: player.user.health });
    } else {
      // Player is unconscious (0 to -9 HP)
      // Send unconscious message to player
      writeFormattedMessageToClient(
        player,
        colorize(`You collapse to the ground unconscious! You are bleeding out and will die at -10 HP.\r\n`, 'red')
      );
      
      // Mark player as unconscious
      player.user.isUnconscious = true;
      this.userManager.updateUserStats(player.user.username, { isUnconscious: true });
      
      // Broadcast to others using the default boldYellow for status messages
      const username = formatUsername(player.user.username);
      const message = `${username} has fallen unconscious!\r\n`;
      
      // Broadcast to all other players in the room
      this.broadcastRoomCombatMessage(roomId, message, 'boldYellow', player.user.username);
    }
    
    // End combat for this player
    const combat = this.combats.get(player.user.username);
    if (combat) {
      combat.endCombat(false);
      this.combats.delete(player.user.username);
    }
    
    // Set player's inCombat to false
    player.user.inCombat = false;
    this.userManager.updateUserStats(player.user.username, { inCombat: false });
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
      this.broadcastRoomCombatMessage(roomId, dropMessage, 'cyan');
      
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
          this.broadcastRoomCombatMessage(roomId, dropMessage, 'cyan');
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
      
      // Restore player to full health instead of half
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
      writeFormattedMessageToClient(
        player,
        colorize(`You have been teleported to the starting area.\r\n`, 'yellow')
      );
      
      // Show the room description
      const roomDescription = startingRoom.getDescriptionExcludingPlayer(player.user.username);
      writeToClient(player, roomDescription);
      
      // Announce to others in the starting room
      const username = formatUsername(player.user.username);
      this.broadcastRoomCombatMessage(
        startingRoomId,
        `${username} materializes in the room, looking disoriented.\r\n`,
        'yellow',
        player.user.username
      );
    }
  }

  /**
   * Scan all rooms for hostile NPCs and players in the same room
   * This ensures hostile NPCs will attack players even if the players
   * were already in the room before the NPC spawned
   */
  private scanRoomsForHostileNPCs(): void {
    console.log(`[CombatSystem] Scanning all rooms for hostile NPCs and players`);
    
    // Get all rooms from the room manager
    const rooms = this.roomManager.getAllRooms();
    
    for (const room of rooms) {
      if (!room.npcs || room.npcs.length === 0 || !room.players || room.players.length === 0) {
        continue; // Skip rooms with no NPCs or no players
      }
      
      // Check for hostile NPCs in this room
      for (const npcName of room.npcs) {
        // Get entity to check its hostility
        const entity = this.getSharedEntity(room.id, npcName);
        
        if (entity && entity.isHostile) {
          console.log(`[CombatSystem] Found hostile NPC ${npcName} in room ${room.id} with ${room.players.length} players`);
          
          // Add the entity to active combat entities for this room if not already
          if (!this.isEntityInCombat(room.id, npcName)) {
            this.addEntityToCombatForRoom(room.id, npcName);
          }
          
          // Generate an entity ID for tracking
          const entityId = this.getEntityId(room.id, npcName);
          
          // For each player in the room, ensure they're on the NPC's aggression list
          for (const playerName of room.players) {
            if (!entity.hasAggression(playerName)) {
              console.log(`[CombatSystem] Adding player ${playerName} to aggression list of ${npcName} in room ${room.id}`);
              
              // Add aggression with 0 damage to indicate awareness rather than damage dealt
              entity.addAggression(playerName, 0);
            }
          }
        }
      }
    }
  }
}