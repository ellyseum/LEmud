import { ClientState, ClientStateType, ConnectedClient } from '../types';
import { colorize, colors, rainbow } from '../utils/colors';
import { writeToClient } from '../utils/socketWriter';

export class ConnectingState implements ClientState {
  name = ClientStateType.CONNECTING;

  enter(client: ConnectedClient): void {
    // Use writeToClient utility instead of directly accessing socket
    writeToClient(client, colors.clear);
    writeToClient(client, colorize('========================================\r\n', 'bright'));
    writeToClient(client, colorize('       ', 'bright') + rainbow('WELCOME TO THE TEXT ADVENTURE') + '\r\n');
    writeToClient(client, colorize('========================================\r\n\r\n', 'bright'));
  }

  handle(client: ConnectedClient, input: string): void {
    // This state automatically transitions to LOGIN in StateMachine
  }
  
  exit(client: ConnectedClient): void {
    // No specific cleanup needed for connecting state
  }
}
