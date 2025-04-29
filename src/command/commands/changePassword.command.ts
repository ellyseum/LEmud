import { ConnectedClient, ClientStateType } from '../../types';
import { Command } from '../command.interface';
import { StateMachine } from '../../state/stateMachine';

export class ChangePasswordCommand implements Command {
  name = 'changepassword';
  description = 'Change your password.';

  constructor(private stateMachine: StateMachine) {}

  execute(client: ConnectedClient): void {
    if (!client.user) return;

    this.stateMachine.transitionTo(client, ClientStateType.CHANGE_PASSWORD);
  }
}
