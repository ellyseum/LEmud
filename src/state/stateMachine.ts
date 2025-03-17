import { ConnectedClient, ClientState, ClientStateType } from '../types';
import { colorize, colors, rainbow } from '../utils/colors';
import { UserManager } from '../user/userManager';
import { writeToClient } from '../utils/socketWriter';

export class StateMachine {
  private states: Map<ClientStateType, ClientState> = new Map();
  private userManager: UserManager;

  constructor(userManager: UserManager) {
    this.userManager = userManager;
    this.setupStates();
  }

  private setupStates() {
    // Connection state - initial welcome screen
    this.registerState({
      name: ClientStateType.CONNECTING,
      enter: (client: ConnectedClient) => {
        client.socket.write(colors.clear);
        client.socket.write(colorize('========================================\r\n', 'bright'));
        client.socket.write(colorize('       ', 'bright') + rainbow('WELCOME TO THE TEXT ADVENTURE') + '\r\n');
        client.socket.write(colorize('========================================\r\n\r\n', 'bright'));
        this.transitionTo(client, ClientStateType.LOGIN);
      },
      handle: () => {} // No input handling in this state
    });

    // Login state
    this.registerState({
      name: ClientStateType.LOGIN,
      enter: (client: ConnectedClient) => {
        client.stateData = {
          maskInput: false // Start with normal echo
        }; 
        writeToClient(client, colorize('Enter your username (or "new" to sign up): ', 'cyan'));
      },
      handle: (client: ConnectedClient, input: string) => {
        if (input.toLowerCase() === 'new') {
          this.transitionTo(client, ClientStateType.SIGNUP);
          return;
        }

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
    });

    // Signup state
    this.registerState({
      name: ClientStateType.SIGNUP,
      enter: (client: ConnectedClient) => {
        client.stateData = {
          maskInput: false // Start with normal echo
        };
        writeToClient(client, colorize('Create a username: ', 'green'));
      },
      handle: (client: ConnectedClient, input: string) => {
        // If we're coming from "user doesn't exist" in login state
        if (client.stateData.offerSignup) {
          if (input.toLowerCase() === 'y') {
            client.stateData = {
              maskInput: false
            }; // Reset state data
            writeToClient(client, colorize('Create a username: ', 'green'));
            return;
          } else if (input.toLowerCase() === 'n') {
            this.transitionTo(client, ClientStateType.LOGIN);
            return;
          } else {
            writeToClient(client, colorize('Please enter y or n: ', 'red'));
            return;
          }
        }

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
                this.transitionTo(client, ClientStateType.AUTHENTICATED);
              } else {
                writeToClient(client, colorize('Error creating user. Please try again.\r\n', 'red'));
                this.transitionTo(client, ClientStateType.LOGIN);
              }
            } else {
              writeToClient(client, colorize('Error creating user. Please try again.\r\n', 'red'));
              this.transitionTo(client, ClientStateType.LOGIN);
            }
          }
        }
      }
    });

    // Authenticated state
    this.registerState({
      name: ClientStateType.AUTHENTICATED,
      enter: (client: ConnectedClient) => {
        if (!client.user) return;
        
        client.socket.write(colors.clear);
        client.socket.write(colorize('========================================\r\n', 'bright'));
        client.socket.write(colorize(`Welcome, ${client.user.username}!\r\n`, 'green'));
        client.socket.write(colorize(`Health: ${client.user.health}/${client.user.maxHealth} | XP: ${client.user.experience} | Level: ${client.user.level}\r\n`, 'cyan'));
        client.socket.write(colorize('Type "help" for a list of commands.\r\n', 'yellow'));
        client.socket.write(colorize('========================================\r\n\r\n', 'bright'));
      },
      handle: () => {
        // Command handling is done separately in CommandHandler
      }
    });
  }

  public registerState(state: ClientState): void {
    this.states.set(state.name, state);
  }

  public transitionTo(client: ConnectedClient, stateName: ClientStateType): void {
    const state = this.states.get(stateName);
    if (!state) {
      console.error(`State "${stateName}" not found`);
      return;
    }

    client.state = stateName;
    state.enter(client);
  }

  public handleInput(client: ConnectedClient, input: string): void {
    // Ensure input is trimmed
    const trimmedInput = input.trim();
    
    // Special case for login state with password input
    if (client.state === ClientStateType.LOGIN && client.stateData.awaitingPassword) {
      const username = client.stateData.username;
      
      if (this.userManager.authenticateUser(username, trimmedInput)) {
        client.stateData.maskInput = false; // Disable masking after successful login
        const user = this.userManager.getUser(username);
        if (user) {
          client.user = user;
          client.authenticated = true;
          // Update last login time
          this.userManager.updateLastLogin(username);
          this.transitionTo(client, ClientStateType.AUTHENTICATED);
        }
      } else {
        writeToClient(client, colorize('Invalid password. Try again: ', 'red'));
        // Keep masking enabled for retrying password
      }
      return;
    }

    const state = this.states.get(client.state);
    if (state) {
      state.handle(client, trimmedInput);
    } else {
      console.error(`No handler for state "${client.state}"`);
    }
  }
}
