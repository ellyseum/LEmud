import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';

export class HelpCommand implements Command {
  name = 'help';
  description = 'Show this help message';

  constructor(private commands: Map<string, Command>) {}

  execute(client: ConnectedClient, args: string): void {
    writeToClient(client, colorize('=== Available Commands ===\r\n\r\n', 'bright'));
    
    // Get unique commands (excluding directional shortcuts)
    const uniqueCommands = new Map<string, Command>();
    for (const [name, command] of this.commands.entries()) {
      // Skip directions which are specialized move commands
      if (['north', 'south', 'east', 'west', 'up', 'down',
           'northeast', 'northwest', 'southeast', 'southwest',
           'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'u', 'd'].includes(name)) {
        continue;
      }
      uniqueCommands.set(name, command);
    }
    
    // Sort commands alphabetically
    const sortedCommands = Array.from(uniqueCommands.entries())
      .sort((a, b) => a[0].localeCompare(b[0]));
    
    // Find the longest command name for proper padding
    const longestCommandLength = Math.max(...sortedCommands.map(([name]) => name.length));
    
    // Use a consistent format with explicit column width
    for (const [name, command] of sortedCommands) {
      // Using a fixed-width format with clear column separation
      const paddedName = name.padEnd(longestCommandLength + 2);
      writeToClient(client, colorize(`  ${paddedName}`, 'yellow') + 
                          colorize(` - ${command.description}\r\n`, 'cyan'));
    }
    
    writeToClient(client, colorize('\r\n==========================\r\n', 'bright'));
  }
}
