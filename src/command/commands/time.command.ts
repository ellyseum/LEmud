import { Command } from '../command.interface';
import { ConnectedClient } from '../../types';
import { writeToClient } from '../../utils/socketWriter';
import { colorize } from '../../utils/colors';

export class TimeCommand implements Command {
  name = 'time';
  description = 'Show the current server time';

  execute(client: ConnectedClient, args: string): void {
    const currentTime = new Date().toLocaleString();
    const timeMessage = `Current server time: ${currentTime}\r\n`;
    writeToClient(client, colorize(timeMessage, 'cyan'));
  }
}
