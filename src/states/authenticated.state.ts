import { ClientState, ClientStateType, ConnectedClient, User } from '../types';
import { colorize, colors } from '../utils/colors';
import { writeToClient, writeMessageToClient, writeFormattedMessageToClient, drawCommandPrompt } from '../utils/socketWriter';
import { formatUsername } from '../utils/formatters';
import { writeCommandPrompt } from '../utils/promptFormatter';
import { RoomManager } from '../room/roomManager';
import { UserManager } from '../user/userManager';
import { CombatSystem } from '../combat/combatSystem';
import { CommandHandler } from '../utils/commandHandler';
import { ItemManager } from '../utils/itemManager';
import { CommandRegistry } from '../command/commandRegistry';
import { StateMachine } from '../state/stateMachine'; // Add StateMachine import

export class AuthenticatedState implements ClientState {
  name = ClientStateType.AUTHENTICATED;
  private roomManager: RoomManager;
  private userManager: UserManager;
  private combatSystem: CombatSystem;
  private commandHandler: CommandHandler;
  private commandRegistry: CommandRegistry;

  constructor(private clients: Map<string, ConnectedClient>, private stateMachine?: StateMachine) {
    // Get singleton instances
    this.roomManager = RoomManager.getInstance(clients);
    this.userManager = UserManager.getInstance();
    this.combatSystem = CombatSystem.getInstance(this.userManager, this.roomManager);
    this.commandHandler = new CommandHandler(this.roomManager, this.userManager);
    
    // Use the singleton instance of CommandRegistry
    this.commandRegistry = CommandRegistry.getInstance(
      clients,
      this.roomManager,
      this.combatSystem,
      this.userManager,
      this.stateMachine || null // Pass stateMachine instance or null if not provided
    );
    
    // Connect the command registry to the command handler
    this.commandHandler.setCommandRegistry(this.commandRegistry);
  }

  public enter(client: ConnectedClient): void {
    if (!client.user) {
      client.stateData.transitionTo = ClientStateType.LOGIN;
      return;
    }

    // Reset state data for fresh state
    client.stateData = client.stateData || {};

    // Initialize ItemManager for equipment calculations
    const itemManager = ItemManager.getInstance();

    // Check for undefined character statistics and initialize them if needed
    if (client.user && (
      client.user.strength === undefined || 
      client.user.dexterity === undefined || 
      client.user.agility === undefined || 
      client.user.constitution === undefined ||
      client.user.wisdom === undefined || 
      client.user.intelligence === undefined || 
      client.user.charisma === undefined
    )) {
      console.log(`[AuthenticatedState] Initializing missing statistics for ${client.user.username}`);
      
      // Create default stats object with only the missing properties
      const defaultStats: Partial<User> = {};
      
      if (client.user.strength === undefined) defaultStats.strength = 10;
      if (client.user.dexterity === undefined) defaultStats.dexterity = 10;
      if (client.user.agility === undefined) defaultStats.agility = 10;
      if (client.user.constitution === undefined) defaultStats.constitution = 10;
      if (client.user.wisdom === undefined) defaultStats.wisdom = 10;
      if (client.user.intelligence === undefined) defaultStats.intelligence = 10;
      if (client.user.charisma === undefined) defaultStats.charisma = 10;
      
      // Update only the missing stats
      Object.assign(client.user, defaultStats);
      
      // Save the updated user stats to persistence
      this.userManager.updateUserStats(client.user.username, defaultStats);
      
      writeToClient(client, colorize(`Your character statistics have been initialized!\r\n`, 'green'));
    }

    // Check for undefined combat stats and equipment
    if (client.user && (
      client.user.attack === undefined ||
      client.user.defense === undefined ||
      client.user.equipment === undefined
    )) {
      console.log(`[AuthenticatedState] Initializing missing combat stats and equipment for ${client.user.username}`);
      
      // Create default values for missing properties
      const defaultCombatStats: Partial<User> = {};
      
      // Initialize combat stats based on character attributes
      if (client.user.attack === undefined) {
        defaultCombatStats.attack = Math.floor(client.user.strength / 2);
      }
      
      if (client.user.defense === undefined) {
        defaultCombatStats.defense = Math.floor(client.user.constitution / 2);
      }
      
      if (client.user.equipment === undefined) {
        defaultCombatStats.equipment = {};
      }
      
      // Update user with defaults
      Object.assign(client.user, defaultCombatStats);
      
      // Save the updated stats to persistence
      this.userManager.updateUserStats(client.user.username, defaultCombatStats);
      
      writeToClient(client, colorize(`Your combat statistics have been initialized!\r\n`, 'green'));
    }

    // Recalculate and update attack and defense values based on equipment
    if (client.user.equipment) {
      client.user.attack = itemManager.calculateAttack(client.user);
      client.user.defense = itemManager.calculateDefense(client.user);
      
      // We don't need to notify the user about this - it happens every login
      this.userManager.updateUserStats(client.user.username, {
        attack: client.user.attack,
        defense: client.user.defense
      });
    }

    // Check and fix inconsistent unconscious state
    if (client.user.isUnconscious && client.user.health > 0) {
      console.log(`[AuthenticatedState] Fixing inconsistent unconscious state for ${client.user.username}. HP: ${client.user.health}, but marked as unconscious`);
      client.user.isUnconscious = false;
      this.userManager.updateUserStats(client.user.username, { isUnconscious: false });
      writeToClient(client, colorize(`You regain consciousness as your health has been restored above 0.\r\n`, 'green'));
    }

    // Auto-heal when session transfer happens to avoid issues if player was low health
    if (client.stateData && client.stateData.isSessionTransfer) {
      // Check if health is low in a session transfer and auto-heal partially if needed
      // This prevents player from getting killed immediately after transfer
      if (client.user.health < client.user.maxHealth * 0.3) {
        // Heal to at least 30% of max health to give a fighting chance
        client.user.health = Math.max(client.user.health, Math.floor(client.user.maxHealth * 0.3));
        this.userManager.updateUserStats(client.user.username, { health: client.user.health });
      }
    }

    // Ensure client is in the room
    if (client.user.currentRoomId) {
      // Try to use the most likely method - let's use the direct Room approach
      const room = this.roomManager.getRoom(client.user.currentRoomId);
      if (room && room.npcs.size > 0) {
        const npcsArray = Array.from(room.npcs.values());
        if (npcsArray.length > 0) {
          const firstNpc = npcsArray[0];
          console.log(`[AuthenticatedState] Room has NPCs. First NPC: ${firstNpc.name}`);
        }
        this.checkForHostileNPCs(client, room);
      }
    }
    
    // Draw banner and show room description
    this.drawBanner(client);
    this.roomManager.lookRoom(client);
    
    // FIX: Explicitly draw the command prompt after room description
    // This ensures there's no extra line between room description and prompt
    drawCommandPrompt(client);
    
    // If player is in combat, make sure the prompt shows the correct state
    if (client.user.inCombat) {
      console.log(`[AuthenticatedState] User ${client.user.username} entered with inCombat flag set`);
      
      // Fix for combat after session transfer: ensure combat system knows about this client
      if (!this.combatSystem.isInCombat(client)) {
        console.log(`[AuthenticatedState] Combat flag mismatch - fixing`);
        
        // Get the current room to find potential targets
        const room = this.roomManager.getRoom(client.user.currentRoomId);
        if (room && room.npcs.size > 0) {
          const npcsArray = Array.from(room.npcs.values());
          if (npcsArray.length > 0) {
            const firstNpc = npcsArray[0];
            console.log(`[AuthenticatedState] Room has NPCs. First NPC: ${firstNpc.name}`);
          }
          this.commandHandler.handleAttackCommand(client, [npcsArray[0].instanceId]);
        } else {
          // No valid targets, clear combat flag
          client.user.inCombat = false;
          this.userManager.updateUserStats(client.user.username, { inCombat: false });
        }
      }
    }
    
    // Broadcast login notification to other players
    this.broadcastLogin(client);
  }

  handle(client: ConnectedClient, input: string): void {
    // Make sure we have a valid authenticated user
    if (!client.user) {
      client.stateData.transitionTo = ClientStateType.LOGIN;
      return;
    }
    
    // Use the CommandHandler to process the command
    this.commandHandler.handleCommand(client, input);
  }

  /**
   * Draw welcome banner for the player
   */
  private drawBanner(client: ConnectedClient): void {
    if (!client.user) return;
    
    // Create a horizontal line
    const line = "========================================";
    
    writeToClient(client, `${line}\r\n`);
    writeToClient(client, colorize(`Welcome, ${formatUsername(client.user.username)}!\r\n`, 'green'));
    writeToClient(client, colorize(`Health: ${client.user.health}/${client.user.maxHealth} | XP: ${client.user.experience} | Level: ${client.user.level}\r\n`, 'bright'));
    
    // If this is a new session (not a transfer), show more info
    if (!client.stateData.isSessionTransfer) {
      // Fix: use a valid color type instead of 'gray'
      writeToClient(client, colorize(`Type "help" for a list of commands.\r\n`, 'dim'));
    }
    
    writeToClient(client, `${line}\r\n`);
  }

  // Broadcast login notification to all authenticated users except the one logging in
  private broadcastLogin(joiningClient: ConnectedClient): void {
    if (!joiningClient.user) return;

    const username = formatUsername(joiningClient.user.username);
    const message = `${username} has entered the game.\r\n`;
    
    for (const [_, client] of this.clients.entries()) {
      // Only send to authenticated users who are not the joining client
      if (client.authenticated && client !== joiningClient) {
        writeFormattedMessageToClient(client, colorize(message, 'bright'));
      }
    }
  }

  /**
   * Check for hostile NPCs in the room and add them to combat entities list
   * so they can attack players automatically
   */
  private checkForHostileNPCs(client: ConnectedClient, room: any): void {
    if (!client.user || !room || !room.npcs || !room.npcs.size) return;
    
    console.log(`[AuthenticatedState] Checking for hostile NPCs in room ${room.id} for player ${client.user.username}`);
    
    for (const npc of room.npcs.values()) {
      // Create a temporary entity to check if it's hostile
      const npcEntity = this.combatSystem['getSharedEntity'](room.id, npc.instanceId);
      
      if (npcEntity && npcEntity.isHostile) {
        console.log(`[AuthenticatedState] Found hostile NPC ${npc.instanceId} in room ${room.id}`);
        
        // Add the entity to active combat entities for this room
        this.combatSystem['addEntityToCombatForRoom'](room.id, npc.instanceId);
        
        // Generate an entity ID for tracking
        const entityId = this.combatSystem.getEntityId(room.id, npc.instanceId);
        
        // Reset attack status to ensure it can attack in the next round
        this.combatSystem['resetEntityAttackStatus'](entityId);
      }
    }
  }
}
