import { ConnectedClient } from '../types';
import { RoomManager } from '../room/roomManager';
import { UserManager } from '../user/userManager';
import { CombatSystem } from '../combat/combatSystem';
import { writeToClient, writeFormattedMessageToClient } from './socketWriter';
import { colorize } from './colors';
import { CommandRegistry } from '../command/commandRegistry';
import { SudoCommand } from '../command/commands/sudo.command';

export class CommandHandler {
  private combatSystem: CombatSystem;
  private commandRegistry: CommandRegistry | null = null;
  private sudoCommand: SudoCommand | null = null;
  
  constructor(
    private roomManager: RoomManager,
    private userManager: UserManager
  ) {
    this.combatSystem = CombatSystem.getInstance(userManager, roomManager);
  }
  
  /**
   * Set the command registry for this handler
   * This is needed to resolve circular dependency issues
   */
  public setCommandRegistry(registry: CommandRegistry): void {
    this.commandRegistry = registry;
    
    // Get the sudo command for admin privilege checking
    const sudoCmd = registry.getCommand('sudo');
    if (sudoCmd && sudoCmd instanceof SudoCommand) {
      this.sudoCommand = sudoCmd;
    }
  }
  
  /**
   * Handle a command from a client
   */
  public handleCommand(client: ConnectedClient, input: string): void {
    if (!this.commandRegistry) {
      writeToClient(client, colorize('Error: Command registry not initialized.\r\n', 'red'));
      return;
    }
    
    // Store this handler instance in client state data for access by commands
    if (!client.stateData) {
      client.stateData = {};
    }
    
    client.stateData.commandHandler = this;
    
    // Also store sudo command for admin privilege checking
    if (this.sudoCommand) {
      if (!client.stateData.commands) {
        client.stateData.commands = new Map();
      }
      client.stateData.commands.set('sudo', this.sudoCommand);
    }
    
    // Execute the command
    this.commandRegistry.executeCommand(client, input);
  }
  
  /**
   * Check if a user has admin privileges
   */
  public hasAdminPrivileges(username: string): boolean {
    if (!this.sudoCommand) {
      // If sudo command is not available, only admin user has privileges
      return username === 'admin';
    }
    
    return this.sudoCommand.isAuthorized(username);
  }

  public handleAttackCommand(client: ConnectedClient, args: string[]): void {
    if (!client.user || !client.user.currentRoomId) return;

    // If in combat, describe current state
    if (client.user.inCombat && this.combatSystem.isInCombat(client)) {
      writeFormattedMessageToClient(client, "You're already in combat!\r\n");
      return;
    }

    // Check for empty target
    if (args.length === 0) {
      writeToClient(client, "Attack what?\r\n");
      return;
    }

    const targetName = args.join(' ');
    const room = this.roomManager.getRoom(client.user.currentRoomId);
    
    if (!room) {
      writeFormattedMessageToClient(client, "You're in a void with nothing to attack.\r\n");
      return;
    }

    // Check if there's an NPC with this name in the room
    if (room.npcs.includes(targetName)) {
      // Create a dummy NPC to use for combat
      const target = this.combatSystem.createTestNPC(targetName);
      
      // Start combat with this target
      if (this.combatSystem.engageCombat(client, target)) {
        // Combat successfully started - handled by engageCombat
        // Ensure session transfer combat state is cleared after successfully starting combat
        if (client.stateData && client.stateData.isSessionTransfer) {
          delete client.stateData.isSessionTransfer;
        }
      } else {
        writeFormattedMessageToClient(client, `You can't attack ${targetName} right now.\r\n`);
      }
    } else {
      writeFormattedMessageToClient(client, `You don't see a '${targetName}' here to attack.\r\n`);
    }
  }

  // Other command handlers would be implemented here
}
