import { ClientState, ClientStateType, ConnectedClient } from '../types';
import { UserManager } from '../user/userManager';
import { colorize } from '../utils/colors';
import { writeToClient } from '../utils/socketWriter';

export class SignupState implements ClientState {
  name = ClientStateType.SIGNUP;
  
  constructor(private userManager: UserManager) {}

  enter(client: ConnectedClient): void {
    client.stateData = {
      maskInput: false // Start with normal echo
    };
    writeToClient(client, colorize('Create a username: ', 'green'));
  }

  handle(client: ConnectedClient, input: string): void {
    // Remove the offerSignup handling since it's now handled in LoginState
    
    // If we're waiting for a username
    if (!client.stateData.username) {
      if (this.userManager.userExists(input)) {
        writeToClient(client, colorize('Username already exists. Choose another one: ', 'red'));
      } else if (input.length < 3) {
        writeToClient(client, colorize('Username too short. Choose a longer one: ', 'red'));
      } else {
        client.stateData.username = input;
        client.stateData.maskInput = true; // Enable password masking
        writeToClient(client, colorize('Create a password: ', 'green'));
      }
    }
    // If we're waiting for a password
    else if (!client.stateData.password) {
      if (input.length < 4) {
        writeToClient(client, colorize('Password too short. Choose a longer one: ', 'red'));
      } else {
        client.stateData.password = input;
        client.stateData.maskInput = false; // Disable masking after password input
        
        // Create the user
        if (this.userManager.createUser(client.stateData.username, client.stateData.password)) {
          const user = this.userManager.getUser(client.stateData.username);
          if (user) {
            client.user = user;
            client.authenticated = true;
            client.stateData.transitionTo = ClientStateType.AUTHENTICATED;
          } else {
            writeToClient(client, colorize('Error creating user. Please try again.\r\n', 'red'));
            client.stateData.transitionTo = ClientStateType.LOGIN;
          }
        } else {
          writeToClient(client, colorize('Error creating user. Please try again.\r\n', 'red'));
          client.stateData.transitionTo = ClientStateType.LOGIN;
        }
      }
    }
  }
}
