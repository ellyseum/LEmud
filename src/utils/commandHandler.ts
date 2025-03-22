import { ConnectedClient } from '../types';
import { RoomManager } from '../room/roomManager';
import { UserManager } from '../user/userManager';
import { CombatSystem } from '../combat/combatSystem';
import { writeToClient, writeFormattedMessageToClient } from './socketWriter';
import { colorize } from './colors';

export class CommandHandler {
  private combatSystem: CombatSystem;
  
  constructor(
    private roomManager: RoomManager,
    private userManager: UserManager
  ) {
    this.combatSystem = CombatSystem.getInstance(userManager, roomManager);
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
