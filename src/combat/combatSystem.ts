import { ConnectedClient } from '../types';
import { Combat } from './combat';
import { CombatEntity } from './combatEntity.interface';
import { colorize } from '../utils/colors';
import { writeFormattedMessageToClient, drawCommandPrompt, writeToClient } from '../utils/socketWriter';
import { UserManager } from '../user/userManager';
import { NPC } from './npc';
import { RoomManager } from '../room/roomManager';
import { formatUsername } from '../utils/formatters';
import { systemLogger, getPlayerLogger } from '../utils/logger';

// Import our new components
import { EntityTracker } from './components/EntityTracker';
import { CombatProcessor } from './components/CombatProcessor';
import { CombatNotifier } from './components/CombatNotifier';
import { PlayerDeathHandler } from './components/PlayerDeathHandler';
import { CombatEventBus } from './components/CombatEventBus';
import { CombatCommand, CombatCommandFactory } from './components/CombatCommand';
import { CombatState, ActiveCombatState, FleeingCombatState } from './components/CombatState';
import { ColorType } from '../utils/colors';

/**
 * Core combat system that orchestrates combat interactions
 */
export class CombatSystem {
  private static instance: CombatSystem | null = null;
  
  // Individual combat instances per player
  private combats: Map<string, Combat> = new Map();
  
  // Component instances
  private entityTracker: EntityTracker;
  private combatProcessor: CombatProcessor;
  private combatNotifier: CombatNotifier;
  private playerDeathHandler: PlayerDeathHandler;
  private eventBus: CombatEventBus;
  private commandFactory: CombatCommandFactory;
  
  // Track player combat states
  private playerCombatStates: Map<string, CombatState> = new Map();
  
  private constructor(
    private userManager: UserManager,
    private roomManager: RoomManager
  ) {
    // Initialize components
    this.eventBus = new CombatEventBus();
    this.entityTracker = new EntityTracker(roomManager);
    this.combatNotifier = new CombatNotifier(roomManager);
    this.combatProcessor = new CombatProcessor(
      this.entityTracker,
      this.combatNotifier,
      userManager,
      roomManager
    );
    this.playerDeathHandler = new PlayerDeathHandler(
      userManager,
      roomManager,
      this.combatNotifier
    );
    this.commandFactory = new CombatCommandFactory(
      this.combatNotifier,
      userManager
    );
    
    // Set up event listeners
    this.setupEventListeners();
  }

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
   * Set up event listeners for combat events
   */
  private setupEventListeners(): void {
    // Listen for player death events
    this.eventBus.on('player.damage', (data: { player: ConnectedClient, roomId: string }) => {
      if (data.player.user && data.player.user.health <= 0) {
        this.playerDeathHandler.handlePlayerHealth(data.player, data.roomId);
      }
    });
    
    // Listen for combat end events
    this.eventBus.on('combat.end', (username: string) => {
      this.removeCombatForPlayer(username);
    });
    
    // More event listeners can be added here
  }
  
  /**
   * Get a unique ID for an entity in a room
   */
  getEntityId(roomId: string, entityName: string): string {
    return this.entityTracker.getEntityId(roomId, entityName);
  }

  /**
   * Engage a player in combat with a target
   */
  engageCombat(player: ConnectedClient, target: CombatEntity): boolean {
    if (!player.user || !player.user.currentRoomId) return false;

    const roomId = player.user.currentRoomId;
    // Ensure we're using the instance ID for NPCs
    const entityName = (target as any).instanceId || target.name;
    const entityId = this.getEntityId(roomId, entityName);
    const playerLogger = getPlayerLogger(player.user.username);
    
    // Always get or create a shared entity using the instance ID if available
    const sharedTarget = this.entityTracker.getSharedEntity(roomId, entityName);
    if (!sharedTarget) return false;
    
    // Check if player is already in combat with a different NPC
    let combat = this.combats.get(player.user.username);
    if (combat && combat.activeCombatants.length > 0) {
      // Allow switching to a new target - clear old targets first
      combat.activeCombatants = [];
      
      // Log the target switch
      systemLogger.debug(`Player ${player.user.username} switched target to ${sharedTarget.name} (ID: ${entityName})`);
      playerLogger.info(`Switched combat target to ${sharedTarget.name} (ID: ${entityName})`);
      
      // Notify player
      writeFormattedMessageToClient(
        player,
        colorize(`You turn your attention to ${sharedTarget.name}.\r\n`, 'yellow')
      );
    }
    
    // Track that the player is targeting this entity - use instance ID
    this.entityTracker.trackEntityTargeter(entityId, player.user.username);
    
    // Add the entity to active combat entities for this room - use instance ID
    this.entityTracker.addEntityToCombatForRoom(roomId, entityName);
    
    // If a combat instance exists but the player's inCombat flag is off, re-engage combat
    if (combat && !player.user.inCombat) {
      systemLogger.debug(`Re-engaging combat for ${player.user.username}`);
      playerLogger.info(`Re-engaging combat with ${sharedTarget.name} (ID: ${entityName})`);
      
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
      this.combatNotifier.broadcastCombatStart(player, sharedTarget);
      
      // Create initial combat state for player
      this.setPlayerCombatState(player.user.username, 'active');
    }
    
    combat.addTarget(sharedTarget);
    
    return true;
  }
  
  /**
   * Set the combat state for a player
   */
  private setPlayerCombatState(username: string, stateName: 'active' | 'fleeing'): void {
    // Create appropriate state based on name
    let state: CombatState;
    
    const handleAttack = (attacker: CombatEntity, target: CombatEntity): boolean => {
      // Default attack handling logic
      return Math.random() >= 0.5; // 50% hit chance
    };
    
    const handleMovement = (entity: ConnectedClient): void => {
      // Default movement handling logic
      if (entity.user) {
        this.handlePlayerMovedRooms(entity);
      }
    };
    
    const handleDisconnect = (entity: ConnectedClient): void => {
      // Default disconnect handling logic
      this.handlePlayerDisconnect(entity);
    };
    
    if (stateName === 'fleeing') {
      state = new FleeingCombatState(handleAttack, handleMovement, handleDisconnect);
    } else {
      state = new ActiveCombatState(handleAttack, handleMovement, handleDisconnect);
    }
    
    this.playerCombatStates.set(username, state);
  }

  /**
   * Process combat rounds for all active combats
   */
  processCombatRound(): void {
    // Update the global combat round in processor
    this.combatProcessor.processCombatRound();
    
    systemLogger.debug(`Processing combat round ${this.combatProcessor.getCurrentRound()} for ${this.combats.size} active combats`);
    
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
        systemLogger.warn(`Player ${username} is no longer valid, marking for removal from combat system`);
        // Player is no longer valid, mark for removal
        playersToRemove.push(username);
        continue;
      }
      
      // CRITICAL: Ensure player reference is updated
      if (client && client.user && client !== combat.player) {
        systemLogger.debug(`Updating combat player reference for ${username}`);
        combat.updateClientReference(client);
      }
      
      systemLogger.debug(`Processing combat for ${username} with ${combat.activeCombatants.length} combatants`);
      
      // Update last activity time
      combat.lastActivityTime = currentTime;
      
      // Set the current round on the combat instance
      combat.currentRound = this.combatProcessor.getCurrentRound();
      combat.processRound();
      
      // Check if combat is done
      if (combat.isDone()) {
        systemLogger.info(`Combat for ${username} is done, cleaning up`);
        const playerLogger = client?.user ? getPlayerLogger(client.user.username) : null;
        if (playerLogger) {
          playerLogger.info(`Combat ended`);
        }
        
        combat.endCombat();
        playersToRemove.push(username);
      }
    }
    
    // Clean up any combats that are done or have disconnected players
    for (const username of playersToRemove) {
      systemLogger.debug(`Removing combat for ${username}`);
      this.removeCombatForPlayer(username);
    }
    
    // Process room combat (NPCs attacking players)
    this.combatProcessor.processRoomCombat();
  }

  /**
   * Attempt to break combat for a player
   */
  breakCombat(player: ConnectedClient): boolean {
    if (!player.user) return false;
    
    const combat = this.combats.get(player.user.username);
    if (!combat) return false;
    
    // Set player's combat state to fleeing
    this.setPlayerCombatState(player.user.username, 'fleeing');
    
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
   * Clean up a dead entity
   */
  cleanupDeadEntity(roomId: string, entityName: string): void {
    this.entityTracker.cleanupDeadEntity(roomId, entityName);
  }

  /**
   * Manually remove combat for a player
   */
  removeCombatForPlayer(username: string): void {
    // Remove the combat instance for this player
    this.combats.delete(username);
    
    // Remove the player's combat state
    this.playerCombatStates.delete(username);
    
    // Clean up entity targeters for this player
    const entitiesToCheck: string[] = [];
    
    // We need to find all entities this player is targeting
    // This code would need to be updated to use the entityTracker
    for (const [entityId, targeters] of this.entityTracker['entityTargeters'].entries()) {
      if (targeters.has(username)) {
        entitiesToCheck.push(entityId);
        this.entityTracker.removeEntityTargeter(entityId, username);
      }
    }
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
      this.removeCombatForPlayer(username);
      
      // Notify others in the room that the player is no longer in combat
      if (roomId) {
        const formattedUsername = formatUsername(username);
        this.combatNotifier.broadcastRoomMessage(
          roomId,
          `${formattedUsername} is no longer in combat (disconnected).\r\n`,
          'yellow',
          username
        );
      }
    }
    
    // Update player's inCombat status before they disconnect
    player.user.inCombat = false;
    this.userManager.updateUserStats(username, { inCombat: false });
  }

  /**
   * Handle a session transfer for a player in combat
   */
  public handleSessionTransfer(oldClient: ConnectedClient, newClient: ConnectedClient): void {
    if (!oldClient.user || !newClient.user) return;
    
    const username = oldClient.user.username;
    systemLogger.info(`Handling session transfer for ${username}`);
    const playerLogger = getPlayerLogger(username);
    
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
      systemLogger.info(`User ${username} is in combat, preserving combat state`);
      playerLogger.info(`Session transfer while in combat - preserving combat state`);
      
      newClient.user.inCombat = true;
      this.userManager.updateUserStats(username, { inCombat: true });
      
      // Get existing combat instance
      let combat = this.combats.get(username);
      
      if (combat) {
        systemLogger.debug(`Found existing combat instance for ${username}`);
        
        // IMPORTANT - Clone info from old combat before updating reference
        const activeCombatantsCopy = [...combat.activeCombatants];
        
        // Update the combat instance with the new client reference
        combat.updateClientReference(newClient);
        
        // Verify active combatants are still present after reference update
        if (combat.activeCombatants.length === 0 && activeCombatantsCopy.length > 0) {
          systemLogger.warn(`Warning: Lost combatants during reference update, restoring`);
          combat.activeCombatants = activeCombatantsCopy;
        }
      } else {
        // No existing combat found but user is in combat - recreate it
        systemLogger.warn(`No combat instance found but user ${username} has inCombat flag, recreating`);
        playerLogger.warn(`Combat instance missing but inCombat flag is set - recreating combat`);
        
        combat = new Combat(newClient, this.userManager, this.roomManager, this);
        
        // Add stronger reference binding to prevent it from being garbage collected
        newClient.stateData.combatInstance = combat;
        
        // Store in the combats map
        this.combats.set(username, combat);
        
        // Preserve combat state
        const prevState = this.playerCombatStates.get(username);
        if (prevState) {
          this.playerCombatStates.set(username, prevState);
        } else {
          this.setPlayerCombatState(username, 'active');
        }
        
        // If in a room, add a target
        if (newClient.user.currentRoomId) {
          const room = this.roomManager.getRoom(newClient.user.currentRoomId);
          if (room && room.npcs.size > 0) {
            // Force recreation of combat with the first NPC in the room
            const npcsInRoom = Array.from(room.npcs.values());
            if (npcsInRoom.length > 0) {
              const firstNpc = npcsInRoom[0];
              const npc = this.entityTracker.getSharedEntity(newClient.user.currentRoomId, firstNpc.instanceId);
              if (npc) {
                combat.addTarget(npc);
                const entityId = this.getEntityId(newClient.user.currentRoomId, firstNpc.instanceId);
                this.entityTracker.trackEntityTargeter(entityId, username);
                systemLogger.info(`Added ${firstNpc.name} as target for ${username} during transfer recreation`);
                playerLogger.info(`Added ${firstNpc.name} as combat target during session transfer`);
                
                // Reset NPC attack state to prevent immediate attack
                this.combatProcessor.resetEntityAttackStatus(entityId);
              }
            }
          }
        }
      }
      
      // Always notify the player they're still in combat
      writeToClient(newClient, colorize('\r\nCombat state transferred. You are still in combat!\r\n', 'boldYellow'));
      
      // CRITICAL FIX: Make sure the client's UI state shows they're in combat
      if (combat && combat.activeCombatants.length > 0) {
        // Force the combat prompt to appear by explicitly setting inCombat
        const clearLineSequence = '\r\x1B[K';
        writeToClient(newClient, clearLineSequence);
        
        // This draws the [COMBAT] prompt properly
        drawCommandPrompt(newClient);
        
        // Add a timestamp to track last activity
        combat.lastActivityTime = Date.now();
      }
    } else {
      systemLogger.debug(`User ${username} is not in combat, nothing to transfer`);
    }
    
    // Remove the transfer in progress flag after a delay
    setTimeout(() => {
      if (oldClient.stateData) {
        delete oldClient.stateData.transferInProgress;
      }
    }, 10000);
  }

  /**
   * Track player movement between rooms
   */
  public handlePlayerMovedRooms(player: ConnectedClient): void {
    if (!player.user) return;
    
    const username = player.user.username;
    systemLogger.debug(`Player ${username} moved rooms while in combat. Combat will continue until next tick checks positions.`);
    
    // We intentionally don't end combat here, allowing the player to move freely
    // The combat system's processRound() will handle ending combat during the next tick
    // if the player and target are not in the same room
  }

  /**
   * Get all opponents for a player in combat
   */
  getOpponents(playerOrUsername: string | ConnectedClient): CombatEntity[] {
    // Handle both string and ConnectedClient inputs safely
    let username: string;
    
    if (typeof playerOrUsername === 'string') {
      username = playerOrUsername;
    } else if (playerOrUsername?.user?.username) {
      username = playerOrUsername.user.username;
    } else {
      systemLogger.warn('getOpponents called with invalid player data');
      return [];
    }
    
    // Find which combat this player is in
    const combat = this.combats.get(username);
    if (!combat || !combat.activeCombatants) {
      return [];
    }
    
    // Return all entities that are not this player
    return combat.activeCombatants.filter(entity => {
      if (!entity) return false;
      
      // For NPCs, always include them as opponents
      if (entity instanceof NPC) {
        return true;
      }
      
      // For other entities, check if it's not the current player
      if (typeof entity.getName === 'function' && entity.getName() === username) {
        return false;
      }
      
      // Fallback to checking the name property directly
      return entity.name !== username;
    });
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
   * @deprecated Use CombatNotifier.broadcastRoomMessage instead
   * Backward compatibility method for broadcasting combat messages
   */
  broadcastRoomCombatMessage(
    roomId: string, 
    message: string, 
    color: ColorType = 'boldYellow', 
    excludeUsername?: string
  ): void {
    this.combatNotifier.broadcastRoomMessage(roomId, message, color, excludeUsername);
  }

  /**
   * @deprecated Use EntityTracker.getSharedEntity instead
   * Backward compatibility method for getting a shared entity
   */
  getSharedEntity(roomId: string, entityName: string): CombatEntity | null {
    return this.entityTracker.getSharedEntity(roomId, entityName);
  }

  /**
   * @deprecated Use EntityTracker.addEntityToCombatForRoom instead
   * Backward compatibility method for adding an entity to combat for a room
   */
  addEntityToCombatForRoom(roomId: string, entityName: string): void {
    this.entityTracker.addEntityToCombatForRoom(roomId, entityName);
  }

  /**
   * @deprecated Use EntityTracker.removeEntityFromCombatForRoom instead
   * Backward compatibility method for removing an entity from combat for a room
   */
  removeEntityFromCombatForRoom(roomId: string, entityName: string): void {
    this.entityTracker.removeEntityFromCombatForRoom(roomId, entityName);
  }

  /**
   * @deprecated Use CombatProcessor.resetEntityAttackStatus instead
   * Backward compatibility method for resetting entity attack status
   */
  resetEntityAttackStatus(entityId: string): void {
    this.combatProcessor.resetEntityAttackStatus(entityId);
  }

  /**
   * @deprecated Use CombatProcessor.hasEntityAttackedThisRound instead
   * Backward compatibility method for checking if an entity has attacked this round
   */
  hasEntityAttackedThisRound(entityId: string): boolean {
    return this.combatProcessor.hasEntityAttackedThisRound(entityId);
  }

  /**
   * @deprecated Use CombatProcessor.markEntityAttacked instead
   * Backward compatibility method for marking an entity as attacked
   */
  markEntityAttacked(entityId: string): void {
    this.combatProcessor.markEntityAttacked(entityId);
  }

  /**
   * @deprecated Use EntityTracker.getEntityTargeters instead
   * Backward compatibility method for getting entity targeters
   */
  getEntityTargeters(entityId: string): string[] {
    return this.entityTracker.getEntityTargeters(entityId);
  }

  /**
   * @deprecated Use EntityTracker.removeEntityTargeter instead
   * Backward compatibility method for removing an entity targeter
   */
  removeEntityTargeter(entityId: string, username: string): void {
    this.entityTracker.removeEntityTargeter(entityId, username);
  }

  /**
   * @deprecated Use CombatProcessor.processRoomCombat instead
   * Backward compatibility method for processing room combat
   */
  processRoomCombat(): void {
    this.combatProcessor.processRoomCombat();
  }

  /**
   * @deprecated Use EntityTracker.createTestNPC instead
   * Backward compatibility method for creating a test NPC
   */
  createTestNPC(name: string = 'cat'): NPC {
    return this.entityTracker['createTestNPC'](name);
  }
}