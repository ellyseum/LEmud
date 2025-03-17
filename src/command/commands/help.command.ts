import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';

export class HelpCommand implements Command {
  name = 'help';
  description = 'Show this help message';

  constructor(private commands: Map<string, Command>) {}

  execute(client: ConnectedClient, args: string): void {
    writeToClient(client, colorize('=== Available Commands ===\r\n', 'bright'));
    
    this.commands.forEach(command => {
      writeToClient(client, colorize(`${command.name} - ${command.description}\r\n`, 'cyan'));
    });
    
    writeToClient(client, colorize('==========================\r\n', 'bright'));
  }
}
