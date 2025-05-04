import { ClientState, ClientStateType, ConnectedClient } from '../types';
import { UserManager } from '../user/userManager';
import { colorize } from '../utils/colors';
import { writeToClient } from '../utils/socketWriter';

export class ChangePasswordState implements ClientState {
  name = ClientStateType.CHANGE_PASSWORD;
  private userManager: UserManager;

  constructor(userManager: UserManager) {
    this.userManager = userManager;
  }

  enter(client: ConnectedClient): void {
    client.stateData = {
      maskInput: true,
      currentPassword: '',
      newPassword: '',
      verifyPassword: '',
      step: 'currentPassword'
    };
    client.connection.setMaskInput(true);
    writeToClient(client, colorize('Enter your current password: ', 'cyan'));
  }

  handle(client: ConnectedClient, input: string): void {
    const step = client.stateData.step;

    switch (step) {
      case 'currentPassword':
        this.handleCurrentPassword(client, input);
        break;
      case 'newPassword':
        this.handleNewPassword(client, input);
        break;
      case 'verifyPassword':
        this.handleVerifyPassword(client, input);
        break;
      default:
        writeToClient(client, colorize('An error occurred. Please try again.\r\n', 'red'));
        client.stateData.transitionTo = ClientStateType.AUTHENTICATED;
        break;
    }
  }

  private handleCurrentPassword(client: ConnectedClient, input: string): void {
    const username = client.user?.username;
    if (!username) {
      writeToClient(client, colorize('An error occurred. Please try again.\r\n', 'red'));
      client.stateData.transitionTo = ClientStateType.AUTHENTICATED;
      return;
    }

    if (this.userManager.authenticateUser(username, input)) {
      client.stateData.currentPassword = input;
      client.stateData.step = 'newPassword';
      writeToClient(client, colorize('Enter your new password: ', 'cyan'));
    } else {
      writeToClient(client, colorize('Your password is incorrect.\r\n', 'red'));
      client.stateData.transitionTo = ClientStateType.AUTHENTICATED;
    }
  }

  private handleNewPassword(client: ConnectedClient, input: string): void {
    client.stateData.newPassword = input;
    client.stateData.step = 'verifyPassword';
    writeToClient(client, colorize('Verify your new password: ', 'cyan'));
  }

  private handleVerifyPassword(client: ConnectedClient, input: string): void {
    if (input === client.stateData.newPassword) {
      const username = client.user?.username;
      if (!username) {
        writeToClient(client, colorize('An error occurred. Please try again.\r\n', 'red'));
        client.stateData.transitionTo = ClientStateType.AUTHENTICATED;
        return;
      }

      this.userManager.changeUserPassword(username, client.stateData.newPassword);
      writeToClient(client, colorize('Your password has been changed.\r\n', 'yellow'));
      client.stateData.transitionTo = ClientStateType.AUTHENTICATED;
    } else {
      writeToClient(client, colorize('Passwords are different!\r\n', 'red'));
      client.stateData.step = 'newPassword';
      writeToClient(client, colorize('Enter your new password: ', 'cyan'));
    }
  }

  exit(client: ConnectedClient): void {
    client.connection.setMaskInput(false);
  }
}
