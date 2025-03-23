import { ConnectedClient } from '../../types';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';
import { CombatSystem } from '../../combat/combatSystem';
import { UserManager } from '../../user/userManager';
import { colorize } from '../../utils/colors';
import { writeFormattedMessageToClient } from '../../utils/socketWriter';

export class MoveCommand implements Command {
  name = 'move';
  description = 'Move in a direction (north, south, east, west, etc.)';
  private roomManager: RoomManager;
  private combatSystem: CombatSystem;

  constructor(clients: Map<string, ConnectedClient>) {
    // Use singleton instances
    this.roomManager = RoomManager.getInstance(clients);
    const userManager = UserManager.getInstance();
    this.combatSystem = CombatSystem.getInstance(userManager, this.roomManager);
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) {
      writeFormattedMessageToClient(client, colorize(`You must be logged in to move.\r\n`, 'red'));
      return;
    }
    
    // Check if the player is in a valid room first
    this.roomManager.teleportToStartingRoomIfNeeded(client);
    
    const direction = args.trim().toLowerCase();
    
    if (!direction) {
      return;
    }

    // Check if player is in combat and handle it before moving
    if (client.user.inCombat && this.combatSystem) {
      // We're moving rooms, so notify the player they're fleeing combat
      writeFormattedMessageToClient(client, colorize(`You flee from combat!\r\n`, 'boldYellow'));
      
      // Let the combat system know the player is fleeing
      this.combatSystem.handlePlayerMovedRooms(client);
    }

    // Now proceed with the movement
    this.roomManager.movePlayer(client, direction);
  }
}
