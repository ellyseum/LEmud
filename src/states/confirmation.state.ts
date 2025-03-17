import { ClientState, ClientStateType, ConnectedClient } from '../types';
import { UserManager } from '../user/userManager';
import { colorize } from '../utils/colors';
import { writeToClient } from '../utils/socketWriter';

export class ConfirmationState implements ClientState {
  name = ClientStateType.CONFIRMATION;
  
  constructor(private userManager: UserManager) {}

  enter(client: ConnectedClient): void {
    if (!client.user) {
      // Something went wrong, go back to login
      client.stateData.transitionTo = ClientStateType.LOGIN;
      return;
    }
    
    client.stateData.maskInput = false;
    writeToClient(client, colorize('======== User Registration Complete ========\r\n', 'bright'));
    writeToClient(client, colorize(`Username: ${client.user.username}\r\n`, 'green'));
    writeToClient(client, colorize(`Account created on: ${client.user.joinDate.toLocaleDateString()}\r\n`, 'cyan'));
    writeToClient(client, colorize('\r\nPlease review your account details.\r\n', 'yellow'));
    writeToClient(client, colorize('Type "confirm" to complete registration or "cancel" to abort: ', 'magenta'));
  }

  handle(client: ConnectedClient, input: string): void {
    const command = input.toLowerCase();
    
    if (command === 'confirm') {
      // Only set authenticated to true AFTER confirmation
      client.authenticated = true;
      writeToClient(client, colorize('Registration confirmed! Welcome to the adventure!\r\n', 'green'));
      client.stateData.transitionTo = ClientStateType.AUTHENTICATED;
    } else if (command === 'cancel') {
      // Remove the user if they cancel
      if (client.user) {
        const username = client.user.username;
        this.userManager.deleteUser(username);
        
        // Reset the client
        client.user = null;
        client.authenticated = false;
      }
      
      writeToClient(client, colorize('Registration cancelled. Please try again if you change your mind.\r\n', 'red'));
      client.stateData.transitionTo = ClientStateType.LOGIN;
    } else {
      writeToClient(client, colorize('Invalid command. Please type "confirm" or "cancel": ', 'red'));
    }
  }
}
