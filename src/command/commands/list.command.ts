import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';

export class ListCommand implements Command {
  name = 'list';
  description = 'Show online users';

  constructor(private clients: Map<string, ConnectedClient>) {}

  execute(client: ConnectedClient, args: string): void {
    // List all authenticated users
    const users = Array.from(this.clients.values())
      .filter(c => c.authenticated && c.user)
      .map(c => c.user!.username);

    writeToClient(client, colorize('=== Online Users ===\r\n', 'magenta'));
    if (users.length === 0) {
      writeToClient(client, colorize('No users online.\r\n', 'yellow'));
    } else {
      users.forEach(username => {
        writeToClient(client, colorize(`- ${username}\r\n`, 'green'));
      });
    }
    writeToClient(client, colorize('===================\r\n', 'magenta'));
  }
}
