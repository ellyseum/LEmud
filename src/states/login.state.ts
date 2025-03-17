import { ClientState, ClientStateType, ConnectedClient } from '../types';
import { UserManager } from '../user/userManager';
import { colorize } from '../utils/colors';
import { writeToClient } from '../utils/socketWriter';
import { config } from '../config';

export class LoginState implements ClientState {
  name = ClientStateType.LOGIN;
  
  constructor(private userManager: UserManager) {}

  enter(client: ConnectedClient): void {
    client.stateData = {
      maskInput: false, // Start with normal echo
      passwordAttempts: 0 // Initialize password attempts counter
    }; 
    writeToClient(client, colorize('Enter your username (or "new" to sign up): ', 'cyan'));
  }

  handle(client: ConnectedClient, input: string): void {
    // Handle "new" command for signup
    if (input.toLowerCase() === 'new') {
      client.stateData.transitionTo = ClientStateType.SIGNUP;
      return;
    }

    // If we're offering signup (user not found)
    if (client.stateData.offerSignup) {
      if (input.toLowerCase() === 'y') {
        // User wants to sign up, DO NOT reset state data - keep username
        client.stateData.maskInput = false; // Ensure no masking for username
        client.stateData.offerSignup = false; // Clear the offer signup flag
        client.stateData.transitionTo = ClientStateType.SIGNUP;
        return;
      } else if (input.toLowerCase() === 'n') {
        // User doesn't want to sign up, reset to login state
        this.enter(client); // Re-initialize login state
        return;
      } else {
        // Invalid response, ask again
        writeToClient(client, colorize('Please enter y or n: ', 'red'));
        return;
      }
    }

    // Normal login flow - check if user exists
    const username = input;
    if (this.userManager.userExists(username)) {
      client.stateData.username = username;
      client.stateData.awaitingPassword = true;
      client.stateData.maskInput = true; // Enable password masking
      writeToClient(client, colorize('Enter your password: ', 'cyan'));
    } else {
      client.stateData.offerSignup = true;
      client.stateData.username = username;
      client.stateData.maskInput = false; // Ensure no masking for yes/no input
      writeToClient(client, colorize('User does not exist. Would you like to sign up? (y/n): ', 'red'));
    }
  }
  
  handlePassword(client: ConnectedClient, input: string): boolean {
    const username = client.stateData.username;
    
    // Fix: Make sure username is defined before using it
    if (!username) {
      writeToClient(client, colorize('Error: Username is not set. Please try again.\r\n', 'red'));
      client.stateData.transitionTo = ClientStateType.LOGIN;
      return false;
    }
    
    // Track password attempts
    client.stateData.passwordAttempts = (client.stateData.passwordAttempts || 0) + 1;
    
    if (this.userManager.authenticateUser(username, input)) {
      client.stateData.maskInput = false; // Disable masking after successful login
      const user = this.userManager.getUser(username);
      if (user) {
        client.user = user;
        client.authenticated = true;
        // Update last login time - username is now guaranteed to be a string
        this.userManager.updateLastLogin(username);
        return true; // Authentication successful
      }
    } else {
      // Check if the user has exceeded the maximum number of password attempts
      if (client.stateData.passwordAttempts >= config.maxPasswordAttempts) {
        writeToClient(client, colorize(`\r\nToo many failed password attempts. Disconnecting...\r\n`, 'red'));
        // Set a flag to disconnect the client
        client.stateData.disconnect = true;
        return false;
      }
      
      const attemptsLeft = config.maxPasswordAttempts - client.stateData.passwordAttempts;
      writeToClient(client, colorize(`Invalid password. ${attemptsLeft} attempts remaining: `, 'red'));
      // Keep masking enabled for retrying password
    }
    return false; // Authentication failed
  }
}
