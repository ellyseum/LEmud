import { ConnectedClient } from '../types';
import { colorize } from '../utils/colors';
import { writeToClient } from '../utils/socketWriter';
import { UserManager } from '../user/userManager';
import { Command } from './command.interface';
import { writeCommandPrompt } from '../utils/promptFormatter';

// Import commands
import { SayCommand } from './commands/say.command';
import { ListCommand } from './commands/list.command';
import { StatsCommand } from './commands/stats.command';
import { HealCommand } from './commands/heal.command';
import { DamageCommand } from './commands/damage.command';
import { HelpCommand } from './commands/help.command';
import { QuitCommand } from './commands/quit.command';
import { RoomManager } from '../room/roomManager';
import { LookCommand } from './commands/look.command';
import { MoveCommand } from './commands/move.command';

// Import new commands
import { InventoryCommand } from './commands/inventory.command';
import { PickupCommand } from './commands/pickup.command';
import { DropCommand } from './commands/drop.command';

// Import the new dedicated alias command
import { GetCommand } from './commands/get.command';

export class CommandHandler {
  private commands: Map<string, Command> = new Map();
  private commandAliases: Map<string, string> = new Map(); // Add map for command aliases
  private roomManager: RoomManager;

  constructor(
    private clients: Map<string, ConnectedClient>,
    private userManager: UserManager
  ) {
    // Pass clients to RoomManager
    this.roomManager = new RoomManager(clients);
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
      new QuitCommand(this.userManager, this.roomManager), // Pass roomManager to QuitCommand
      new LookCommand(this.roomManager),
      new MoveCommand(this.roomManager),
      new InventoryCommand(),
      new PickupCommand(this.roomManager, this.userManager),
      new DropCommand(this.roomManager, this.userManager),
      new GetCommand(this.roomManager, this.userManager) // Add the explicit Get command
    ];
    
    // Register all commands
    commands.forEach(cmd => {
      this.commands.set(cmd.name, cmd);
    });
    
    // Register command aliases - no need for 'get' alias anymore since it's an explicit command
    this.commandAliases.set('l', 'look');
    this.commandAliases.set('i', 'inventory');
    this.commandAliases.set('inv', 'inventory');
    // this.commandAliases.set('get', 'pickup');  // Remove this line since we have an explicit command now
    this.commandAliases.set('take', 'pickup');
    
    // Register direction shortcuts
    const moveCommand = commands.find(cmd => cmd.name === 'move') as MoveCommand;
    
    if (moveCommand) {
      // Register direction aliases as separate commands
      const directions = [
        'north', 'south', 'east', 'west',
        'northeast', 'northwest', 'southeast', 'southwest',
        'up', 'down',
        'n', 's', 'e', 'w',
        'ne', 'nw', 'se', 'sw',
        'u', 'd'
      ];
      
      directions.forEach(direction => {
        this.commands.set(direction, {
          name: direction,
          description: `Move ${direction}`,
          execute: (client, _) => moveCommand.execute(client, direction)
        });
      });
    }
    
    // Help command needs to be added after others since it needs access to all commands
    const helpCommand = new HelpCommand(this.commands);
    this.commands.set(helpCommand.name, helpCommand);
  }

  public handleCommand(client: ConnectedClient, input: string): void {
    if (!client.user) return;

    // Ensure input is trimmed
    const cleanInput = input.trim();
    if (cleanInput === '') {
      // Do a brief look when user hits enter with no command
      this.roomManager.briefLookRoom(client);
      writeCommandPrompt(client);
      return;
    }

    const parts = cleanInput.split(' ');
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ').trim(); // Also trim arguments

    // Find and execute command
    let command = this.commands.get(commandName);
    
    // Check aliases if command not found directly
    if (!command && this.commandAliases.has(commandName)) {
      const aliasedCommand = this.commandAliases.get(commandName);
      if (aliasedCommand) {
        command = this.commands.get(aliasedCommand);
      }
    }
    
    if (command) {
      command.execute(client, args);
      
      // Display the command prompt after command execution
      writeCommandPrompt(client);
    } else {
      writeToClient(client, colorize(`Unknown command: ${commandName}\r\n`, 'red'));
      
      // Show help for unknown commands
      const helpCommand = this.commands.get('help');
      if (helpCommand) {
        helpCommand.execute(client, '');
      }
      
      // Display the command prompt after command execution
      writeCommandPrompt(client);
    }
  }
}
