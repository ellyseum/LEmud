import { ConnectedClient, ClientState, ClientStateType } from '../types';
import { UserManager } from '../user/userManager';
import { ConnectingState } from '../states/connecting.state';
import { LoginState } from '../states/login.state';
import { SignupState } from '../states/signup.state';
import { ConfirmationState } from '../states/confirmation.state';
import { AuthenticatedState } from '../states/authenticated.state';
import { TransferRequestState } from '../states/transfer-request.state';

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

  constructor(userManager: UserManager, private clients: Map<string, ConnectedClient>) {
    this.userManager = userManager;
    
    // Initialize state objects
    this.connectingState = new ConnectingState();
    this.loginState = new LoginState(userManager);
    this.signupState = new SignupState(userManager);
    this.confirmationState = new ConfirmationState(userManager);
    this.authenticatedState = new AuthenticatedState(clients); // Pass clients
    this.transferRequestState = new TransferRequestState(userManager);
    
    // Register states
    this.registerState(this.connectingState);
    this.registerState(this.loginState);
    this.registerState(this.signupState);
    this.registerState(this.confirmationState);
    this.registerState(this.authenticatedState);
    this.registerState(this.transferRequestState);
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

    const oldState = client.state;
    client.state = stateName;
    console.log(`State transition: ${oldState} -> ${stateName}`);
    state.enter(client);
    
    // Special case for CONNECTING state - automatically transition to LOGIN
    if (stateName === ClientStateType.CONNECTING) {
      this.transitionTo(client, ClientStateType.LOGIN);
    }
  }

  public handleInput(client: ConnectedClient, input: string): void {
    // Ensure input is trimmed
    const trimmedInput = input.trim();
    
    console.log(`Handling input in state ${client.state}: "${trimmedInput}"`);
    
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
      console.error(`No handler for state "${client.state}"`);
    }
  }
}
