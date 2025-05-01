// filepath: /workspaces/LEmud/src/command/commands/wait.command.ts
import { ConnectedClient, ClientStateType } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { StateMachine } from '../../state/stateMachine';

export class WaitCommand implements Command {
  name = 'wait';
  description = 'Enter a waiting state temporarily';

  constructor(private stateMachine: StateMachine) {}

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) {
      writeToClient(client, colorize('You must be logged in to use the wait command.\r\n', 'red'));
      return;
    }

    // Store current state to return to
    client.stateData.previousState = client.state;
    
    // Store the clients map in the client's stateData so waiting state can access it
    client.stateData.clientsMap = this.stateMachine.getClients();
    
    // Notify player that they are entering the waiting state
    writeToClient(client, colorize('Entering waiting state...\r\n', 'green'));
    
    // Set the transition flag
    client.stateData.transitionTo = ClientStateType.WAITING;

    // Explicitly invoke the state machine to process the transition
    this.stateMachine.handleInput(client, '');
  }
}