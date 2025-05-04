import { ConnectedClient, ClientState, ClientStateType } from '../types';
import { UserManager } from '../user/userManager';
import { ConnectingState } from '../states/connecting.state';
import { LoginState } from '../states/login.state';
import { SignupState } from '../states/signup.state';
import { ConfirmationState } from '../states/confirmation.state';
import { AuthenticatedState } from '../states/authenticated.state';
import { TransferRequestState } from '../states/transfer-request.state';
import { SnakeGameState } from '../states/snake-game.state';
import { WaitingState } from '../states/waiting.state';
import { ChangePasswordState } from '../states/changePassword.state';
import { systemLogger, createContextLogger } from '../utils/logger';

// Create a context-specific logger for StateMachine
const stateLogger = createContextLogger('StateMachine');

// List of commands that might contain sensitive information like passwords
const sensitiveCommands = ['password', 'passwd', 'changepassword', 'setpassword', 'login', 'register'];

export class StateMachine {
  private states: Map<ClientStateType, ClientState> = new Map();
  private userManager: UserManager;
  
  // Create instances of each state
  private connectingState: ConnectingState;
  private loginState: LoginState;
  private signupState: SignupState;
  private confirmationState: ConfirmationState;
  private authenticatedState: AuthenticatedState;
  private transferRequestState: TransferRequestState;
  private snakeGameState: SnakeGameState;
  private waitingState: WaitingState;
  private changePasswordState: ChangePasswordState;

  constructor(userManager: UserManager, private clients: Map<string, ConnectedClient>) {
    this.userManager = userManager;
    
    // Initialize state objects
    this.connectingState = new ConnectingState();
    this.loginState = new LoginState(userManager);
    this.signupState = new SignupState(userManager);
    this.confirmationState = new ConfirmationState(userManager);
    this.authenticatedState = new AuthenticatedState(clients, this); // Pass this (StateMachine) as second parameter
    this.transferRequestState = new TransferRequestState(userManager);
    this.snakeGameState = new SnakeGameState(); // Initialize snake game state
    this.waitingState = new WaitingState(); // Initialize waiting state
    this.changePasswordState = new ChangePasswordState(userManager); // Initialize change password state
    
    // Register states
    this.registerState(this.connectingState);
    this.registerState(this.loginState);
    this.registerState(this.signupState);
    this.registerState(this.confirmationState);
    this.registerState(this.authenticatedState);
    this.registerState(this.transferRequestState);
    this.registerState(this.snakeGameState); // Register snake game state
    this.registerState(this.waitingState); // Register waiting state
    this.registerState(this.changePasswordState); // Register change password state
  }

  public registerState(state: ClientState): void {
    this.states.set(state.name, state);
  }

  public transitionTo(client: ConnectedClient, stateName: ClientStateType): void {
    // Call exit on old state if implemented
    const oldStateName = client.state;
    const oldState = this.states.get(oldStateName);
    if (oldState && typeof oldState.exit === 'function') {
      oldState.exit(client);
    }
    // Transition to new state
    client.state = stateName;
    stateLogger.info(`State transition: ${oldStateName} -> ${stateName}`);
    const state = this.states.get(stateName);
    if (state) {
      state.enter(client);
    }
    
    // Special case for CONNECTING state - automatically transition to LOGIN
    if (stateName === ClientStateType.CONNECTING) {
      this.transitionTo(client, ClientStateType.LOGIN);
    }
  }

  public handleInput(client: ConnectedClient, input: string): void {
    // Ensure input is trimmed
    const trimmedInput = input.trim();
    
    // Don't log any input in login state at all to prevent password leaks
    if (client.state !== ClientStateType.LOGIN) {
      // Check if the input contains sensitive information that should not be logged
      const isSensitive = this.containsSensitiveCommand(trimmedInput);
      
      // Log the input, but mask it if it's sensitive
      if (isSensitive) {
        stateLogger.debug(`Handling input in state ${client.state}: "******" (sensitive content hidden)`);
      } else {
        stateLogger.debug(`Handling input in state ${client.state}: "${trimmedInput}"`);
      }
    }
    // No else clause - don't log anything for login state inputs
    
    // Special case for login state with password input
    if (client.state === ClientStateType.LOGIN && client.stateData.awaitingPassword && !client.stateData.awaitingTransferRequest) {
      if (this.loginState.handlePassword(client, trimmedInput)) {
        this.transitionTo(client, ClientStateType.AUTHENTICATED);
      }
      return;
    }

    const state = this.states.get(client.state);
    if (state) {
      state.handle(client, trimmedInput);
      
      // Check if a state transition was requested
      if (client.stateData.transitionTo) {
        const nextState = client.stateData.transitionTo;
        delete client.stateData.transitionTo; // Clear the transition flag
        this.transitionTo(client, nextState);
      } else if (client.state === ClientStateType.LOGIN && trimmedInput.toLowerCase() === 'new') {
        // Special case for transitioning to signup
        this.transitionTo(client, ClientStateType.SIGNUP);
      }
    } else {
      stateLogger.error(`No handler for state "${client.state}"`);
    }
  }

  /**
   * Checks if the input contains a command that might include sensitive information
   */
  private containsSensitiveCommand(input: string): boolean {
    const lowerInput = input.toLowerCase();
    
    // Check if the input starts with any of the sensitive commands
    return sensitiveCommands.some(cmd => 
      lowerInput === cmd || 
      lowerInput.startsWith(`${cmd} `) || 
      lowerInput.startsWith(`/${cmd} `)
    );
  }

  /**
   * Get the clients map
   */
  public getClients(): Map<string, ConnectedClient> {
    return this.clients;
  }
}
