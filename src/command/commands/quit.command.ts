import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';
import { RoomManager } from '../../room/roomManager';
import { CombatSystem } from '../../combat/combatSystem';

export class QuitCommand implements Command {
  name = 'quit';
  description = 'Disconnect from the server';
  private roomManager: RoomManager;
  private combatSystem: CombatSystem;

  constructor(
    private userManager: UserManager,
    clients: Map<string, ConnectedClient> // Change parameter type
  ) {
    // Use singleton instance
    this.roomManager = RoomManager.getInstance(clients);
    this.combatSystem = CombatSystem.getInstance(userManager, this.roomManager);
  }

  execute(client: ConnectedClient): void {
    if (!client.user) return;

    // Check if player is in combat and end it
    if (client.user.inCombat) {
      this.combatSystem.handlePlayerDisconnect(client);
    }

    writeToClient(client, colorize('Thank you for playing! Goodbye.\r\n', 'yellow'));
    
    // Remove player from all rooms before disconnecting
    this.roomManager.removePlayerFromAllRooms(client.user.username);
    
    // Save user state before disconnecting
    this.userManager.updateUserStats(client.user.username, {
      lastLogin: new Date()
    });
    
    // Unregister the session
    this.userManager.unregisterUserSession(client.user.username);
    
    // Disconnect after a brief delay so the goodbye message is seen
    setTimeout(() => {
      client.connection.end();
    }, 500);
  }
}
