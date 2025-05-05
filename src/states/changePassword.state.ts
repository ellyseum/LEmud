import { ClientState, ClientStateType, ConnectedClient } from '../types';
import { UserManager } from '../user/userManager';
import { colorize } from '../utils/colors';
import { createContextLogger } from '../utils/logger';
import { writeToClient } from '../utils/socketWriter';

// Create a logger for this state
const passwordStateLogger = createContextLogger('ChangePasswordState');

export class ChangePasswordState implements ClientState {
  name = ClientStateType.CHANGE_PASSWORD;
  private userManager: UserManager;

  constructor(userManager: UserManager) {
    this.userManager = userManager;
  }

  enter(client: ConnectedClient): void {
    // Preserve existing stateData, especially previousState
    const previousState = client.stateData.previousState;

    passwordStateLogger.debug(`Entering ChangePasswordState. Previous state: ${previousState}`);

    // Update stateData without overwriting everything
    client.stateData = {
      ...client.stateData, // Preserve existing properties
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
    passwordStateLogger.debug(`Handling input in step: ${client.stateData.step}`);

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
        // Return to authenticated state or previously stored state
        client.stateData.transitionTo = client.stateData.previousState || ClientStateType.AUTHENTICATED;
        break;
    }
  }

  private handleCurrentPassword(client: ConnectedClient, input: string): void {
    const username = client.user?.username;
    if (!username) {
      writeToClient(client, colorize('An error occurred. Please try again.\r\n', 'red'));
      client.stateData.transitionTo = client.stateData.previousState || ClientStateType.AUTHENTICATED;
      return;
    }

    if (this.userManager.authenticateUser(username, input)) {
      passwordStateLogger.debug(`Current password verified for user: ${username}`);
      client.stateData.currentPassword = input;
      client.stateData.step = 'newPassword';
      writeToClient(client, colorize('Enter your new password: ', 'cyan'));
    } else {
      passwordStateLogger.debug(`Invalid current password for user: ${username}`);
      writeToClient(client, colorize('Your password is incorrect.\r\n', 'red'));
      client.stateData.transitionTo = client.stateData.previousState || ClientStateType.AUTHENTICATED;
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
        client.stateData.transitionTo = client.stateData.previousState || ClientStateType.AUTHENTICATED;
        return;
      }

      passwordStateLogger.info(`Password changed successfully for user: ${username}`);
      this.userManager.changeUserPassword(username, client.stateData.newPassword);
      writeToClient(client, colorize('Your password has been changed.\r\n', 'yellow'));
      client.stateData.transitionTo = client.stateData.previousState || ClientStateType.AUTHENTICATED;
    } else {
      passwordStateLogger.debug(`Password verification failed for user: ${client.user?.username}`);
      writeToClient(client, colorize('Passwords are different!\r\n', 'red'));
      client.stateData.step = 'newPassword';
      writeToClient(client, colorize('Enter your new password: ', 'cyan'));
    }
  }

  exit(client: ConnectedClient): void {
    passwordStateLogger.debug(`Exiting ChangePasswordState for user: ${client.user?.username}`);
    client.connection.setMaskInput(false);

    // Clear sensitive password data
    delete client.stateData.currentPassword;
    delete client.stateData.newPassword;
    delete client.stateData.verifyPassword;
  }
}
