import { ClientState, ClientStateType, ConnectedClient } from '../types';
import { colorize, colors } from '../utils/colors';

export class AuthenticatedState implements ClientState {
  name = ClientStateType.AUTHENTICATED;

  enter(client: ConnectedClient): void {
    if (!client.user) return;
    
    client.socket.write(colors.clear);
    client.socket.write(colorize('========================================\r\n', 'bright'));
    client.socket.write(colorize(`Welcome, ${client.user.username}!\r\n`, 'green'));
    client.socket.write(colorize(`Health: ${client.user.health}/${client.user.maxHealth} | XP: ${client.user.experience} | Level: ${client.user.level}\r\n`, 'cyan'));
    client.socket.write(colorize('Type "help" for a list of commands.\r\n', 'yellow'));
    client.socket.write(colorize('========================================\r\n\r\n', 'bright'));
  }

  handle(): void {
    // Command handling is done separately in CommandHandler
  }
}
