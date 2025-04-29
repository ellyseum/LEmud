import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';

export class ChangePasswordCommand implements Command {
  name = 'changepassword';
  description = 'Change your password. Usage: changepassword <oldPassword> <newPassword>';

  constructor(private userManager: UserManager) {}

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    const [oldPassword, newPassword] = args.split(' ');

    if (!oldPassword || !newPassword) {
      writeToClient(client, colorize('Usage: changepassword <oldPassword> <newPassword>\r\n', 'yellow'));
      return;
    }

    const username = client.user.username;

    if (!this.userManager.authenticateUser(username, oldPassword)) {
      writeToClient(client, colorize('Old password is incorrect.\r\n', 'red'));
      return;
    }

    const success = this.userManager.changeUserPassword(username, newPassword);

    if (success) {
      writeToClient(client, colorize('Password changed successfully.\r\n', 'green'));
    } else {
      writeToClient(client, colorize('Failed to change password.\r\n', 'red'));
    }
  }
}
