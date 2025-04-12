// filepath: /Users/jelden/projects/game/src/command/commands/listflags.command.ts
import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';
import { SudoCommand } from './sudo.command';

export class ListFlagsCommand implements Command {
    name = 'listflags';
    description = 'Lists flags for yourself or a specified user (Admin only for others). Usage: listflags [username]';
    
    constructor(private userManager: UserManager) {}

    execute(client: ConnectedClient, args: string): void {
        if (!client.user) return;

        const targetUsername = args.trim() || client.user.username;
        
        // Check admin status if target is not self
        if (targetUsername.toLowerCase() !== client.user.username.toLowerCase()) {
            const sudoCommand = SudoCommand.getInstance();
            if (!sudoCommand.isAuthorized(client.user.username)) {
                writeToClient(client, colorize('You can only list your own flags. Use "sudo" to gain admin privileges if authorized.\r\n', 'red'));
                return;
            }
        }

        const flags = this.userManager.getFlags(targetUsername);

        if (flags === null) {
            writeToClient(client, colorize(`User ${targetUsername} not found.\r\n`, 'red'));
        } else if (flags.length === 0) {
            writeToClient(client, colorize(`${targetUsername} has no flags set.\r\n`, 'yellow'));
        } else {
            writeToClient(client, colorize(`Flags for ${targetUsername}:\r\n`, 'cyan'));
            flags.forEach(flag => {
                writeToClient(client, colorize(`- ${flag}\r\n`, 'white'));
            });
        }
    }
}