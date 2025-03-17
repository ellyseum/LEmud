import { ClientState, ClientStateType, ConnectedClient } from '../types';
import { colorize, colors } from '../utils/colors';
import { writeToClient } from '../utils/socketWriter';

export class AuthenticatedState implements ClientState {
  name = ClientStateType.AUTHENTICATED;

  enter(client: ConnectedClient): void {
    if (!client.user) return;
    
    writeToClient(client, colors.clear);
    writeToClient(client, colorize('========================================\r\n', 'bright'));
    writeToClient(client, colorize(`Welcome, ${client.user.username}!\r\n`, 'green'));
    writeToClient(client, colorize(`Health: ${client.user.health}/${client.user.maxHealth} | XP: ${client.user.experience} | Level: ${client.user.level}\r\n`, 'cyan'));
    writeToClient(client, colorize('Type "help" for a list of commands.\r\n', 'yellow'));
    writeToClient(client, colorize('========================================\r\n\r\n', 'bright'));
  }

  handle(): void {
    // Command handling is done separately in CommandHandler
  }
}
