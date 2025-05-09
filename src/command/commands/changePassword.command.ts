import { StateMachine } from '../../state/stateMachine';
import { ClientStateType, ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { createContextLogger } from '../../utils/logger';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';

const cmdLogger = createContextLogger('ChangePasswordCommand');

export class ChangePasswordCommand implements Command {
  name = 'changepassword';
  description = 'Change your password. Usage: changepassword';

  constructor(private stateMachine: StateMachine) {}

  execute(client: ConnectedClient, args: string): void {
    cmdLogger.debug(`execute called. current state=${client.state}`);
    if (!client.user) {
      writeToClient(client, colorize('You must be logged in to change your password.\r\n', 'red'));
      return;
    }

    // Store current state to return to
    client.stateData.previousState = client.state;
    cmdLogger.debug(`previousState stored as ${client.stateData.previousState}`);

    // Notify player that they are entering the password change state
    writeToClient(client, colorize('Entering password change mode...\r\n', 'green'));

        // Set the transition flag
        client.stateData.transitionTo = ClientStateType.CHANGE_PASSWORD;

        // Explicitly invoke the state machine to process the transition
        this.stateMachine.handleInput(client, '');

    // // Directly transition to ChangePasswordState
    // this.stateMachine.transitionTo(client, ClientStateType.CHANGE_PASSWORD);
  }
}
