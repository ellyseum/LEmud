import { ClientState, ClientStateType, ConnectedClient } from '../types';
import { colorize, colors, rainbow } from '../utils/colors';

export class ConnectingState implements ClientState {
  name = ClientStateType.CONNECTING;

  enter(client: ConnectedClient): void {
    // Just show the welcome screen
    client.socket.write(colors.clear);
    client.socket.write(colorize('========================================\r\n', 'bright'));
    client.socket.write(colorize('       ', 'bright') + rainbow('WELCOME TO THE TEXT ADVENTURE') + '\r\n');
    client.socket.write(colorize('========================================\r\n\r\n', 'bright'));
    
    // Note: The StateMachine will automatically transition to LOGIN
  }

  handle(): void {
    // No input handling in this state
  }
}
