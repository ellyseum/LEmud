import { ConnectedClient } from '../types';
import { colorize } from '../utils/colors';
import { writeToClient } from '../utils/socketWriter';
import { UserManager } from '../user/userManager';
import { Command } from './command.interface';

// Import commands
import { SayCommand } from './commands/say.command';
import { ListCommand } from './commands/list.command';
import { StatsCommand } from './commands/stats.command';
import { HealCommand } from './commands/heal.command';
import { DamageCommand } from './commands/damage.command';
import { HelpCommand } from './commands/help.command';
import { QuitCommand } from './commands/quit.command';

export class CommandHandler {
  private commands: Map<string, Command> = new Map();

  constructor(
    private clients: Map<string, ConnectedClient>,
    private userManager: UserManager
  ) {
    this.registerCommands();
  }

  private registerCommands(): void {
    // Create command instances
    const commands: Command[] = [
      new SayCommand(this.clients),
      new ListCommand(this.clients),
      new StatsCommand(),
      new HealCommand(this.userManager),
      new DamageCommand(this.userManager),
      new QuitCommand(this.userManager)  // Add the quit command
    ];
    
    // Register all commands
    commands.forEach(cmd => {
      this.commands.set(cmd.name, cmd);
    });
    
    // Help command needs to be added after others since it needs access to all commands
    const helpCommand = new HelpCommand(this.commands);
    this.commands.set(helpCommand.name, helpCommand);
  }

  public handleCommand(client: ConnectedClient, input: string): void {
    if (!client.user) return;

    // Ensure input is trimmed
    const cleanInput = input.trim();
    if (cleanInput === '') {
      // Handle empty input gracefully
      return;
    }

    const parts = cleanInput.split(' ');
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ').trim(); // Also trim arguments

    // Find and execute command
    const command = this.commands.get(commandName);
    if (command) {
      command.execute(client, args);
    } else {
      writeToClient(client, colorize(`Unknown command: ${commandName}\r\n`, 'red'));
      
      // Show help for unknown commands
      const helpCommand = this.commands.get('help');
      if (helpCommand) {
        helpCommand.execute(client, '');
      }
    }
  }
}
