import { ClientState, ClientStateType, ConnectedClient } from '../types';
import { UserManager } from '../user/userManager';
import { colorize } from '../utils/colors';
import { writeToClient } from '../utils/socketWriter';
import { formatUsername, validateUsername, standardizeUsername } from '../utils/formatters';
import { RESTRICTED_USERNAMES } from '../config';
import { systemLogger } from '../utils/logger';

export class SignupState implements ClientState {
  name = ClientStateType.SIGNUP;
  
  constructor(private userManager: UserManager) {}

  enter(client: ConnectedClient): void {
    // Initialize default state values if needed
    client.stateData.maskInput = false;
    
    // Check if we already have a username (came from login state)
    if (client.stateData.username) {
      // Show the username that will be used
      writeToClient(client, colorize(`Username: ${formatUsername(client.stateData.username)}\r\n`, 'green'));
      client.stateData.maskInput = true; // Enable password masking for next input
      writeToClient(client, colorize('Create a password: ', 'green'));
    } else {
      // No username yet, ask for one
      writeToClient(client, colorize('Create a username: ', 'green'));
    }
  }

  handle(client: ConnectedClient, input: string): void {
    // If we're waiting for a username (username not yet set)
    if (!client.stateData.username) {
      // Validate the username format first
      const validation = validateUsername(input);
      
      if (!validation.isValid) {
        writeToClient(client, colorize(`${validation.message}. Please try again: `, 'red'));
        return;
      }

      // Standardize to lowercase for storage and checks
      const standardUsername = standardizeUsername(input);
      
      // Check if the username is in the restricted list
      if (RESTRICTED_USERNAMES.includes(standardUsername)) {
        systemLogger.warn(`Blocked signup attempt with restricted username: ${standardUsername} from ${client.ipAddress || 'unknown IP'}`);
        writeToClient(client, colorize('This username is reserved. Please choose another: ', 'red'));
        return;
      }
      
      if (this.userManager.userExists(standardUsername)) {
        writeToClient(client, colorize('Username already exists. Choose another one: ', 'red'));
      } else if (standardUsername.length < 3) {
        writeToClient(client, colorize('Username too short. Choose a longer one: ', 'red'));
      } else {
        client.stateData.username = standardUsername;
        client.stateData.maskInput = true; // Enable password masking
        
        // Display the username in camelcase format
        writeToClient(client, colorize(`Username set to: ${formatUsername(standardUsername)}\r\n`, 'green'));
        writeToClient(client, colorize('Create a password: ', 'green'));
      }
    }
    // If we're waiting for a password (username is already set)
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
            // Set user but DON'T set authenticated flag yet
            client.user = user;
            client.stateData.transitionTo = ClientStateType.CONFIRMATION;
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
