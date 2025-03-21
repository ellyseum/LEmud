import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient, writeMessageToClient, writeFormattedMessageToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { formatUsername } from '../../utils/formatters';

export class SayCommand implements Command {
  name = 'say';
  description = 'Send a message to all users';

  constructor(private clients: Map<string, ConnectedClient>) {}

  execute(client: ConnectedClient, args: string): void {
    // Check for forced transitions before processing command
    if (client.stateData.forcedTransition) {
      return;
    }

    if (!client.user) return;

    if (!args.trim()) {
      writeToClient(client, colorize('Say what?\r\n', 'yellow'));
      return;
    }

    // Send message to all clients
    this.clients.forEach(c => {
      if (c.authenticated && c.user) {
        if (c === client) {
          // For the sender, use regular output
          writeMessageToClient(c, colorize(`You say '${args}'\r\n`, 'green'));
        } else {
          // For other clients, use the formatted message writer that handles prompt management
          writeFormattedMessageToClient(c, colorize(`${formatUsername(client.user!.username)} says '${args}'\r\n`, 'cyan'));
        }
      }
    });
  }
}
