import { Command } from '../command.interface';
import { ConnectedClient } from '../../types';
import { writeToClient } from '../../utils/socketWriter';
import { colorize } from '../../utils/colors';
import { UserManager } from '../../user/userManager';

export class PlayedCommand implements Command {
  name = 'played';
  description = 'Show the total play time of the current user';

  constructor(private userManager: UserManager) {}

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    const user = this.userManager.getUser(client.user.username);
    if (!user) return;

    const totalPlayTime = user.totalPlayTime ?? 0;
    const playTimeInSeconds = Math.floor(totalPlayTime / 1000);
    const hours = Math.floor(playTimeInSeconds / 3600);
    const minutes = Math.floor((playTimeInSeconds % 3600) / 60);
    const seconds = playTimeInSeconds % 60;

    const playTimeMessage = `Total play time: ${hours}h ${minutes}m ${seconds}s\r\n`;
    writeToClient(client, colorize(playTimeMessage, 'cyan'));
  }
}
