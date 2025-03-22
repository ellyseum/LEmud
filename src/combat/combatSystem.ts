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
   * Get or create a shared entity for a room
   */
  private getSharedEntity(roomId: string, entityName: string): CombatEntity | null {
    if (!this.sharedEntities.has(roomId)) {
      this.sharedEntities.set(roomId, new Map());
    }
    
    const roomEntities = this.sharedEntities.get(roomId)!;
    
    // Try to find an existing entity with this name
    if (roomEntities.has(entityName)) {
      const existingEntity = roomEntities.get(entityName)!;
      
      // If the entity exists but is dead, remove it and create a new one
      if (!existingEntity.isAlive()) {
        roomEntities.delete(entityName);
      } else {
        return existingEntity;
      }
    }
    
    // Look up entity in the room
    const room = this.roomManager.getRoom(roomId);
    if (!room) return null;
    
    // Create a new NPC if it doesn't exist in shared entities
    // Since npcs in room are strings, we need to create a new NPC instance
    if (room.npcs.includes(entityName)) {
      // Create a new NPC with the same name
      const npc = this.createTestNPC(entityName);
      
      // Add to shared entities
      roomEntities.set(entityName, npc);
      return npc;
    }
    
    return null;
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
    const [roomId, entityName] = entityId.split('::');
    
    if (!this.sharedEntities.has(roomId)) {
      return true;
    }
    
    const roomEntities = this.sharedEntities.get(roomId)!;
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

    // Get roomId and check if the target is already being tracked
    const roomId = player.user.currentRoomId;
    const entityId = this.getEntityId(roomId, target.name);
    
    // Try to get a shared entity if one exists
    const sharedTarget = this.getSharedEntity(roomId, target.name);
    if (!sharedTarget) return false;
    
    // Track this player as targeting this entity
    this.trackEntityTargeter(entityId, player.user.username);

    // Check if player is already in combat
    let combat = this.combats.get(player.user.username);
    
    // If not, create a new combat
    if (!combat) {
      combat = new Combat(player, this.userManager, this.roomManager, this);
      this.combats.set(player.user.username, combat);
      
      // Set the inCombat flag
      player.user.inCombat = true;
      this.userManager.updateUserStats(player.user.username, { inCombat: true });
      
      // Use the clear line sequence explicitly to avoid any prompt duplication
      const clearLineSequence = '\r\x1B[K';
      writeToClient(player, clearLineSequence);
      
      // Write the combat engaged message
      writeToClient(player, colorize(`*Combat Engaged*\r\n`, 'boldYellow'));
      
      // Draw a fresh prompt once, using our utility function
      drawCommandPrompt(player);
      
      // Broadcast initial attack message to others
      this.broadcastCombatStart(player, sharedTarget);
    }
    
    // Add the target to combat
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
    
    combat.brokenByPlayer = true;
    
    writeFormattedMessageToClient(
      player,
      colorize(`You attempt to break combat...\r\n`, 'boldYellow')
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
}