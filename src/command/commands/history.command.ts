import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';

export class HistoryCommand implements Command {
  name = 'history';
  description = 'Show your command history';

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    // Ensure the commandHistory array exists
    if (!client.user.commandHistory) {
      writeToClient(client, colorize('No command history available.\r\n', 'yellow'));
      return;
    }

    writeToClient(client, colorize('=== Command History ===\r\n', 'cyan'));
    
    if (client.user.commandHistory.length === 0) {
      writeToClient(client, colorize('No commands in history.\r\n', 'yellow'));
    } else {
      client.user.commandHistory.forEach((cmd, index) => {
        writeToClient(client, colorize(`${index + 1}. ${cmd}\r\n`, 'white'));
      });
    }
    
    writeToClient(client, colorize('======================\r\n', 'cyan'));
  }
}
