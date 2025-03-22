import { ClientState, ClientStateType, ConnectedClient } from '../types';
import { colorize, colors } from '../utils/colors';
import { writeToClient, writeMessageToClient, writeFormattedMessageToClient, drawCommandPrompt } from '../utils/socketWriter';
import { formatUsername } from '../utils/formatters';
import { writeCommandPrompt } from '../utils/promptFormatter';
import { RoomManager } from '../room/roomManager';
import { UserManager } from '../user/userManager';
import { CombatSystem } from '../combat/combatSystem';
import { CommandHandler } from '../utils/commandHandler';

export class AuthenticatedState implements ClientState {
  name = ClientStateType.AUTHENTICATED;
  private roomManager: RoomManager;
  private userManager: UserManager;
  private combatSystem: CombatSystem;
  private commandHandler: CommandHandler;

  constructor(private clients: Map<string, ConnectedClient>) {
    // Get singleton instances
    this.roomManager = RoomManager.getInstance(clients);
    this.userManager = UserManager.getInstance();
    this.combatSystem = CombatSystem.getInstance(this.userManager, this.roomManager);
    this.commandHandler = new CommandHandler(this.roomManager, this.userManager);
  }

  public enter(client: ConnectedClient): void {
    if (!client.user) {
      client.stateData.transitionTo = ClientStateType.LOGIN;
      return;
    }

    // Reset state data for fresh state
    client.stateData = client.stateData || {};

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
      if (room) {
        room.addPlayer(client.user.username);
      }
    }
    
    // Draw banner and show room description
    this.drawBanner(client);
    this.roomManager.lookRoom(client);
    
    // If player is in combat, make sure the prompt shows the correct state
    if (client.user.inCombat) {
      console.log(`[AuthenticatedState] User ${client.user.username} entered with inCombat flag set`);
      
      // Fix for combat after session transfer: ensure combat system knows about this client
      if (!this.combatSystem.isInCombat(client)) {
        console.log(`[AuthenticatedState] Combat flag mismatch - fixing`);
        
        // Get the current room to find potential targets
        const room = this.roomManager.getRoom(client.user.currentRoomId);
        if (room && room.npcs.length > 0) {
          // There are NPCs in the room, try to engage with the first one
          const npcName = room.npcs[0]; 
          // This will create a new combat instance if needed
          this.commandHandler.handleAttackCommand(client, [npcName]);
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

  handle(): void {
    // Command handling is done separately in CommandHandler
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
}
