import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';

export class QuitCommand implements Command {
  name = 'quit';
  description = 'Disconnect from the server';

  constructor(private userManager: UserManager) {}

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    writeToClient(client, colorize('Thank you for playing! Goodbye.\r\n', 'yellow'));
    
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
