import { ClientState, ClientStateType, ConnectedClient } from '../types';
import { UserManager } from '../user/userManager';
import { colorize } from '../utils/colors';
import { writeToClient } from '../utils/socketWriter';
import config, { DISABLE_REMOTE_ADMIN, RESTRICTED_USERNAMES } from '../config';
import { formatUsername, standardizeUsername } from '../utils/formatters';
import { systemLogger } from '../utils/logger';
import { createSessionReferenceFile } from '../utils/fileUtils';

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

  exit(client: ConnectedClient): void {
    // Clean up any login state resources
    if (client.stateData.maskInput) {
      client.stateData.maskInput = false;
      client.connection.setMaskInput(false); // Disable masking on exit
    }
  }

  handle(client: ConnectedClient, input: string): void {
    // Handle transfer request response
    if (client.stateData.awaitingTransferRequest) {
      if (input.toLowerCase() === 'y') {
        // User wants to request a transfer
        const username = client.stateData.username;
        
        // Check if username is defined before proceeding
        if (!username) {
          writeToClient(client, colorize('\r\nError: Username not found. Please try again.\r\n', 'red'));
          client.stateData.transitionTo = ClientStateType.LOGIN;
          return;
        }
        
        if (this.userManager.requestSessionTransfer(username, client)) {
          writeToClient(client, colorize('\r\nTransfer request sent. Waiting for approval...\r\n', 'yellow'));
        } else {
          // Something went wrong or the user is no longer active
          writeToClient(client, colorize('\r\nError sending transfer request. The session may no longer be active.\r\n', 'red'));
          client.stateData.transitionTo = ClientStateType.LOGIN;
        }
      } else {
        // User doesn't want to transfer, just return to login
        writeToClient(client, colorize('\r\nLogin cancelled. Please try again.\r\n', 'red'));
        this.enter(client); // Restart login process
      }
      
      // Clear awaiting flags
      delete client.stateData.awaitingTransferRequest;
      delete client.stateData.authenticatedPassword;
      delete client.stateData.awaitingPassword; // Ensure this is cleared
      return;
    }

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
    const username = input.trim(); // Trim any whitespace
    
    // Prevent empty username submissions
    if (username === '') {
      writeToClient(client, colorize('Username cannot be empty. Please enter a username: ', 'red'));
      return;
    }
    
    // Standardize username for storage and checks
    const standardUsername = standardizeUsername(username);

    // Check if this is a restricted username trying to login remotely
    if (RESTRICTED_USERNAMES.includes(standardUsername) && !client.isConsoleClient) {
      // Check if remote admin login is disabled
      if (DISABLE_REMOTE_ADMIN) {
        systemLogger.warn(`Blocked remote login attempt for restricted username: ${standardUsername} from ${client.ipAddress || 'unknown IP'}`);
        writeToClient(client, colorize(`Invalid username. Please try again: `, 'red'));
        return;
      }
      
      // If specifically trying to login as 'admin' remotely
      if (standardUsername === 'admin' && DISABLE_REMOTE_ADMIN) {
        systemLogger.warn(`Blocked remote admin login attempt from ${client.ipAddress || 'unknown IP'}`);
        writeToClient(client, colorize(`Invalid username. Please try again: `, 'red'));
        return;
      }
    }
    
    if (this.userManager.userExists(standardUsername)) {
      client.stateData.username = standardUsername; // Store lowercase version
      client.stateData.awaitingPassword = true;
      client.stateData.maskInput = true; // Enable password masking
      client.connection.setMaskInput(true); // Enable masking on connection
      writeToClient(client, colorize('Enter your password: ', 'cyan'));
    } else {
      client.stateData.offerSignup = true;
      client.stateData.username = standardUsername; // Store lowercase version
      client.stateData.maskInput = false; // Ensure no masking for yes/no input
      client.connection.setMaskInput(false); // Disable masking for yes/no input
      writeToClient(client, colorize(`User (${formatUsername(standardUsername)}) does not exist. Would you like to sign up? (y/n): `, 'red'));
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
      
      // Check if this user is already logged in elsewhere
      if (this.userManager.isUserActive(username)) {
        // Ask the new login if they want to request a transfer
        writeToClient(client, colorize('\r\n\r\nThis account is currently active in another session.\r\n', 'yellow'));
        writeToClient(client, colorize('Would you like to request a session transfer? (y/n): ', 'cyan'));
        
        // Set up to handle the transfer request response
        client.stateData.awaitingTransferRequest = true;
        // Important fix: Clear the awaitingPassword flag so we don't handle the next input as a password
        client.stateData.awaitingPassword = false;
        client.stateData.authenticatedPassword = input;
        return false; // Don't complete login yet
      }
      
      // If not already logged in, proceed with normal login
      const user = this.userManager.getUser(username);
      if (user) {
        client.user = user;
        client.authenticated = true;
        
        // Only reset combat flag for normal logins, not for session transfers
        // Session transfers should preserve the combat state from the previous session
        if (client.user.inCombat && !client.stateData.isSessionTransfer) {
          client.user.inCombat = false;
          this.userManager.updateUserStats(username, { inCombat: false });
        }
        
        // Update last login time and register new session
        this.userManager.updateLastLogin(username);
        this.userManager.registerUserSession(username, client);
        
        // Create a session reference file for debugging
        const isAdmin = username.toLowerCase() === 'admin';
        createSessionReferenceFile(client, username, isAdmin);
        
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
