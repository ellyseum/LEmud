// filepath: /Users/jelden/projects/game/src/command/commands/addflag.command.ts
import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';
import { SudoCommand } from './sudo.command';
import { createContextLogger } from '../../utils/logger';

// Create a player action logger
const playerLogger = createContextLogger('Player');

export class AddFlagCommand implements Command {
    name = 'addflag';
    description = 'Adds a flag to a specified user (Admin only). Usage: addflag <username> <flag>';
    
    constructor(private userManager: UserManager) {}

    execute(client: ConnectedClient, args: string): void {
        if (!client.user) return;

        // Check if admin mode is enabled for this user
        const sudoCommand = SudoCommand.getInstance();
        if (!sudoCommand.isAuthorized(client.user.username)) {
            writeToClient(client, colorize('You do not have permission to use this command.\r\n', 'red'));
            writeToClient(client, colorize('Use "sudo" to gain admin privileges if authorized.\r\n', 'yellow'));
            return;
        }

        const [username, flag, ...valueTokens] = args.split(' ');
        
        if (!username || !flag) {
            writeToClient(client, colorize('Usage: addflag [username] [flag] [value]\r\n', 'yellow'));
            writeToClient(client, colorize('Example: addflag player1 canEdit true\r\n', 'yellow'));
            return;
        }

        // Check if the user exists
        const user = this.userManager.getUser(username);
        if (!user) {
            writeToClient(client, colorize(`User "${username}" not found.\r\n`, 'red'));
            return;
        }

        // Join the value tokens back together
        const valueRaw = valueTokens.join(' ');
        let value: any;

        // Try to parse value as numeric or boolean if possible
        if (valueRaw === 'true') {
            value = true;
        } else if (valueRaw === 'false') {
            value = false;
        } else if (!isNaN(Number(valueRaw))) {
            value = Number(valueRaw);
        } else {
            value = valueRaw; // Keep as string
        }

        // Format flag with its value
        const flagEntry = `${flag}:${value}`;
        
        // Initialize flags array if it doesn't exist yet
        if (!user.flags) {
            user.flags = [];
        }
        
        // Remove any existing flag with the same name
        user.flags = user.flags.filter(f => !f.startsWith(`${flag}:`));
        
        // Add the new flag
        user.flags.push(flagEntry);
        
        // Update the user's flags using the proper UserManager method
        // The UserManager has an updateUserStats method that takes a username and a partial User object
        const success = this.userManager.updateUserStats(username, { flags: user.flags });
        
        if (!success) {
            // If the update failed, notify the admin
            writeToClient(client, colorize(
                "\r\n\x1b[33mWarning: Could not save user data permanently. Flag was added in memory only.\x1b[0m\r\n", 
                "yellow"
            ));
        }
        
        // Log the player action
        playerLogger.info(`${client.user.username} added flag "${flag}" with value "${value}" to user "${username}"`);

        // Success message to admin
        writeToClient(client, colorize(`Set flag "${flag}" to "${value}" for user "${username}".\r\n`, 'green'));

        // Notify the target user if they're online
        if (username !== client.user.username) {
            const targetClient = this.userManager.getActiveUserSession(username);
            if (targetClient) {
                writeToClient(targetClient, colorize(`Admin ${client.user.username} has updated your account flags.\r\n`, 'yellow'));
            }
        }
    }
}