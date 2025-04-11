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

    // Simply proceed with movement regardless of combat state
    // Combat system will handle checking rooms during next tick
    this.roomManager.movePlayer(client, direction);
  }
}
