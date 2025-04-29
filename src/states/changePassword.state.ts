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
    if (!client.user) return;

    client.stateData = {
      maskInput: true,
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
      step: 'currentPassword'
    };
    writeToClient(client, colorize('Enter the current password: ', 'cyan'));
  }

  handle(client: ConnectedClient, input: string): void {
    if (!client.user) return;

    const stateData = client.stateData;

    switch (stateData.step) {
      case 'currentPassword':
        stateData.currentPassword = input;
        if (this.userManager.authenticateUser(client.user.username, stateData.currentPassword)) {
          stateData.step = 'newPassword';
          writeToClient(client, colorize('\nEnter the new password: ', 'cyan'));
        } else {
          writeToClient(client, colorize('\nIncorrect current password. Try again: ', 'red'));
        }
        break;

      case 'newPassword':
        stateData.newPassword = input;
        stateData.step = 'confirmPassword';
        writeToClient(client, colorize('\nRe-enter the new password: ', 'cyan'));
        break;

      case 'confirmPassword':
        stateData.confirmPassword = input;
        if (stateData.newPassword === stateData.confirmPassword) {
          this.userManager.changeUserPassword(client.user.username, stateData.newPassword);
          // Clear sensitive fields to prevent data leakage
          stateData.currentPassword = '';
          stateData.newPassword = '';
          stateData.confirmPassword = '';
          stateData.step = '';
          writeToClient(client, colorize('\nPassword has been updated!\n', 'green'));
          client.stateData.transitionTo = ClientStateType.AUTHENTICATED;
        } else {
          writeToClient(client, colorize('\nPasswords do not match. Try again: ', 'red'));
          stateData.step = 'newPassword';
          writeToClient(client, colorize('Enter the new password: ', 'cyan'));
        }
        break;
    }
  }
}
