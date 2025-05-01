import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';
import { SudoCommand } from './sudo.command';

export class RemoveFlagCommand implements Command {
    name = 'removeflag';
    description = 'Removes a flag from a specified user (Admin only). Usage: removeflag <username> <flag>';
    
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
        const flagToRemove = parts[1];

        if (!flagToRemove) {
            writeToClient(client, colorize(`You must specify a flag to remove.\r\n`, 'yellow'));
            return;
        }

        const success = this.userManager.removeFlag(targetUsername, flagToRemove);

        if (success) {
            writeToClient(client, colorize(`Flag '${flagToRemove}' removed from user ${targetUsername}.\r\n`, 'green'));
        } else {
            // Check if user exists first
            if (!this.userManager.getUser(targetUsername)) {
                writeToClient(client, colorize(`User ${targetUsername} not found.\r\n`, 'red'));
            } else {
                writeToClient(client, colorize(`Flag '${flagToRemove}' not found for user ${targetUsername} or another error occurred.\r\n`, 'yellow'));
            }
        }
    }
}