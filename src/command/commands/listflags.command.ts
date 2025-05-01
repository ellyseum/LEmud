import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';
import { SudoCommand } from './sudo.command';
import { getPlayerLogger } from '../../utils/logger'; // Import player logger

export class ListFlagsCommand implements Command {
    name = 'listflags';
    description = 'Lists flags for yourself or a specified user (Admin only for others). Usage: listflags [username]';
    
    constructor(private userManager: UserManager) {}

    execute(client: ConnectedClient, args: string): void {
        if (!client.user) return;

        // Get player logger for the current user
        const playerLogger = getPlayerLogger(client.user.username);
        
        const targetUsername = args.trim() || client.user.username;
        
        // Check admin status if target is not self
        if (targetUsername.toLowerCase() !== client.user.username.toLowerCase()) {
            const sudoCommand = SudoCommand.getInstance();
            if (!sudoCommand.isAuthorized(client.user.username)) {
                writeToClient(client, colorize('You can only list your own flags. Use "sudo" to gain admin privileges if authorized.\r\n', 'red'));
                playerLogger.warn(`Attempted to list flags for ${targetUsername} without admin privileges`);
                return;
            }
            
            // Log admin viewing another player's flags
            playerLogger.info(`Admin viewed flags for player ${targetUsername}`);
            
            // If possible, also log to the target player's log that their flags were viewed
            const targetLogger = getPlayerLogger(targetUsername);
            targetLogger.info(`Player ${client.user.username} (admin) viewed your flags`);
        }

        const flags = this.userManager.getFlags(targetUsername);

        if (flags === null) {
            writeToClient(client, colorize(`User ${targetUsername} not found.\r\n`, 'red'));
            playerLogger.warn(`Attempted to list flags for non-existent user ${targetUsername}`);
        } else if (flags.length === 0) {
            writeToClient(client, colorize(`${targetUsername} has no flags set.\r\n`, 'yellow'));
            if (targetUsername === client.user.username) {
                playerLogger.info(`Checked own flags (none set)`);
            }
        } else {
            writeToClient(client, colorize(`Flags for ${targetUsername}:\r\n`, 'cyan'));
            flags.forEach(flag => {
                writeToClient(client, colorize(`- ${flag}\r\n`, 'white'));
            });
            
            if (targetUsername === client.user.username) {
                playerLogger.info(`Checked own flags: ${flags.join(', ')}`);
            }
        }
    }
}