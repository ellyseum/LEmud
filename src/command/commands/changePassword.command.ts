import { ConnectedClient } from '../../types';
import { Command } from '../command.interface';
import { StateMachine } from '../../state/stateMachine';
import { ClientStateType } from '../../types';

export class ChangePasswordCommand implements Command {
  name = 'changepassword';
  description = 'Change your password. Usage: changepassword';

  constructor(private stateMachine: StateMachine) {}

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    // Transition to ChangePasswordState
    this.stateMachine.transitionTo(client, ClientStateType.CHANGE_PASSWORD);
  }
}
