// filepath: /Users/jelden/projects/game/src/command/commands/addflag.command.ts
import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';
import { SudoCommand } from './sudo.command';

export class AddFlagCommand implements Command {
    name = 'addflag';
    description = 'Adds a flag to a specified user (Admin only). Usage: addflag <username> <flag>';
    
    constructor(private userManager: UserManager) {}

    execute(client: ConnectedClient, args: string): void {
        if (!client.user) return;

        // Admin check
        const sudoCommand = SudoCommand.getInstance();
        if (!sudoCommand.isAuthorized(client.user.username)) {
            writeToClient(client, colorize('You do not have permission to use this command.\r\n', 'red'));
            writeToClient(client, colorize('Use "sudo" to gain admin privileges if authorized.\r\n', 'yellow'));
            return;
        }

        const parts = args.trim().split(/\s+/);
        if (parts.length < 2) {
            writeToClient(client, colorize(`Usage: ${this.name} <username> <flag>\r\n`, 'yellow'));
            return;
        }

        const targetUsername = parts[0];
        const flagToAdd = parts[1];

        if (!flagToAdd) {
            writeToClient(client, colorize(`You must specify a flag to add.\r\n`, 'yellow'));
            return;
        }

        const success = this.userManager.addFlag(targetUsername, flagToAdd);

        if (success) {
            writeToClient(client, colorize(`Flag '${flagToAdd}' added to user ${targetUsername}.\r\n`, 'green'));
        } else {
            // Check if user exists first
            if (!this.userManager.getUser(targetUsername)) {
                writeToClient(client, colorize(`User ${targetUsername} not found.\r\n`, 'red'));
            } else {
                writeToClient(client, colorize(`Flag '${flagToAdd}' might already exist for user ${targetUsername} or another error occurred.\r\n`, 'yellow'));
            }
        }
    }
}