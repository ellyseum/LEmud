import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';
import { SudoCommand } from './sudo.command';

export class RestrictCommand implements Command {
  name = 'restrict';
  description = 'Restrict or unrestrict a player\'s movement';
  
  constructor(private userManager: UserManager) {}
  
  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;
    
    // Check if user has admin privileges
    const sudoCommand = SudoCommand.getInstance();
    if (!sudoCommand.isAuthorized(client.user.username)) {
      writeToClient(client, colorize('You do not have permission to use this command.\r\n', 'red'));
      writeToClient(client, colorize('Use "sudo" to gain admin privileges if authorized.\r\n', 'yellow'));
      return;
    }
    
    // Parse arguments
    const argParts = args.split(' ');
    const action = argParts[0]?.toLowerCase(); // 'on' or 'off'
    const targetUsername = argParts[1];
    // Join the remaining arguments as the reason
    const reason = argParts.slice(2).join(' ');
    
    if (!action || !['on', 'off', 'status'].includes(action)) {
      this.showHelp(client);
      return;
    }
    
    // If no target username is provided, default to the user executing the command
    const finalUsername = targetUsername || client.user.username;
    
    // Get the target user
    const targetUser = this.userManager.getUser(finalUsername);
    if (!targetUser) {
      writeToClient(client, colorize(`User ${finalUsername} not found.\r\n`, 'red'));
      return;
    }
    
    // Check the current status of movement restriction
    if (action === 'status') {
      if (targetUser.movementRestricted) {
        writeToClient(client, colorize(`${finalUsername}'s movement is restricted.\r\n`, 'yellow'));
        if (targetUser.movementRestrictedReason) {
          writeToClient(client, colorize(`Reason: ${targetUser.movementRestrictedReason}\r\n`, 'yellow'));
        }
      } else {
        writeToClient(client, colorize(`${finalUsername}'s movement is not restricted.\r\n`, 'green'));
      }
      return;
    }
    
    // Apply or remove the movement restriction
    if (action === 'on') {
      // Set up default reason if none is provided
      const finalReason = reason || "You are unable to move.";
      
      // Update user's movement restriction status
      this.userManager.updateUserStats(finalUsername, {
        movementRestricted: true,
        movementRestrictedReason: finalReason
      });
      
      writeToClient(client, colorize(`${finalUsername}'s movement has been restricted.\r\n`, 'green'));
      writeToClient(client, colorize(`Reason: ${finalReason}\r\n`, 'green'));
      
      // Notify the target user if they're online
      const targetClient = this.userManager.getActiveUserSession(finalUsername);
      if (targetClient && targetClient !== client) {
        writeToClient(targetClient, colorize(`Your movement has been restricted.\r\n`, 'red'));
        writeToClient(targetClient, colorize(`Reason: ${finalReason}\r\n`, 'red'));
      }
    } else if (action === 'off') {
      // Remove movement restriction
      this.userManager.updateUserStats(finalUsername, {
        movementRestricted: false,
        movementRestrictedReason: undefined
      });
      
      writeToClient(client, colorize(`${finalUsername}'s movement restriction has been removed.\r\n`, 'green'));
      
      // Notify the target user if they're online
      const targetClient = this.userManager.getActiveUserSession(finalUsername);
      if (targetClient && targetClient !== client) {
        writeToClient(targetClient, colorize(`Your movement restriction has been removed.\r\n`, 'green'));
      }
    }
  }
  
  private showHelp(client: ConnectedClient): void {
    writeToClient(client, colorize('=== Movement Restriction Command ===\r\n', 'magenta'));
    writeToClient(client, colorize('Usage:\r\n', 'yellow'));
    writeToClient(client, colorize('  restrict on [username] [reason] - Restrict player movement\r\n', 'cyan'));
    writeToClient(client, colorize('  restrict off [username] - Remove movement restriction\r\n', 'cyan'));
    writeToClient(client, colorize('  restrict status [username] - Check movement restriction status\r\n', 'cyan'));
    writeToClient(client, colorize('\r\nIf username is omitted, the command affects your own character.\r\n', 'yellow'));
    writeToClient(client, colorize('This command requires admin privileges.\r\n', 'yellow'));
    writeToClient(client, colorize('=================================\r\n', 'magenta'));
  }
}