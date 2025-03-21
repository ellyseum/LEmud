import { ConnectedClient } from '../types';
import { colorize } from '../utils/colors';
import { writeToClient } from '../utils/socketWriter';
import { writeCommandPrompt } from '../utils/promptFormatter';
import { UserManager } from '../user/userManager';
import { Command } from './command.interface';
import { RoomManager } from '../room/roomManager';

// Command imports can be grouped by functionality
import { SayCommand } from './commands/say.command';
import { ListCommand } from './commands/list.command';
import { StatsCommand } from './commands/stats.command';
import { HealCommand } from './commands/heal.command';
import { DamageCommand } from './commands/damage.command';
import { HelpCommand } from './commands/help.command';
import { QuitCommand } from './commands/quit.command';
import { LookCommand } from './commands/look.command';
import { MoveCommand } from './commands/move.command';
import { InventoryCommand } from './commands/inventory.command';
import { PickupCommand } from './commands/pickup.command';
import { DropCommand } from './commands/drop.command';
import { GetCommand } from './commands/get.command';
import { YellCommand } from './commands/yell.command';
import { HistoryCommand } from './commands/history.command';
import { AttackCommand } from './commands/attack.command';
import { BreakCommand } from './commands/break.command';
import { GameTimerManager } from '../timer/gameTimerManager';
import { SpawnCommand } from './commands/spawn.command';

export class CommandHandler {
  private commands: Map<string, Command> = new Map();
  private commandAliases: Map<string, string> = new Map(); // Add map for command aliases
  private roomManager: RoomManager;

  constructor(
    private clients: Map<string, ConnectedClient>,
    private userManager: UserManager
  ) {
    // Use singleton instance instead of creating a new one
    this.roomManager = RoomManager.getInstance(clients);
    this.registerCommands();
  }

  private registerCommands(): void {
    // Get combat system from GameTimerManager
    const combatSystem = GameTimerManager.getInstance(this.userManager, this.roomManager).getCombatSystem();

    // Create command instances
    const commands: Command[] = [
      new SayCommand(this.clients),
      new ListCommand(this.clients),
      new StatsCommand(),
      new HealCommand(this.userManager),
      new DamageCommand(this.userManager),
      new QuitCommand(this.userManager, this.clients),
      new LookCommand(this.clients),
      new MoveCommand(this.clients),
      new InventoryCommand(),
      new PickupCommand(this.clients, this.userManager),
      new DropCommand(this.clients, this.userManager),
      new GetCommand(this.clients, this.userManager),
      new YellCommand(this.clients),
      new HistoryCommand(),
      new AttackCommand(combatSystem, this.roomManager),
      new BreakCommand(combatSystem),
      new SpawnCommand(this.roomManager) // Add the spawn command
    ];
    
    // Register all commands
    commands.forEach(cmd => {
      this.commands.set(cmd.name, cmd);
    });
    
    // Register command aliases - no need for 'get' alias anymore since it's an explicit command
    this.commandAliases.set('l', 'look');
    this.commandAliases.set('i', 'inventory');
    this.commandAliases.set('inv', 'inventory');
    this.commandAliases.set('hist', 'history'); // Add shortcut for history command
    // this.commandAliases.set('get', 'pickup');  // Remove this line since we have an explicit command now
    this.commandAliases.set('take', 'pickup');
    this.commandAliases.set('a', 'attack');
    this.commandAliases.set('br', 'break');
    this.commandAliases.set('sp', 'spawn'); // Add an alias for spawn
    
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
    
    // Skip empty commands and don't add them to history
    if (cleanInput === '') {
      // Do a brief look when user hits enter with no command
      this.roomManager.briefLookRoom(client);
      writeCommandPrompt(client);
      return;
    }

    // Initialize command history if it doesn't exist
    if (!client.user.commandHistory) {
      client.user.commandHistory = [];
    }

    // Check for repeat command shortcut (single period)
    if (cleanInput === '.') {
      // Make sure user and command history are defined
      if (!client.user.commandHistory || client.user.commandHistory.length === 0) {
        writeToClient(client, colorize('No previous command to repeat.\r\n', 'yellow'));
        writeCommandPrompt(client);
        return;
      }

      // Get the most recent command
      const lastCommand = client.user.commandHistory[client.user.commandHistory.length - 1];
      
      // Display what we're executing
      writeToClient(client, colorize(`Repeating: ${lastCommand}\r\n`, 'dim'));
      
      // Add the repeated command to history
      client.user.commandHistory.push(lastCommand);
      
      // Keep only the most recent 30 commands
      if (client.user.commandHistory.length > 30) {
        client.user.commandHistory.shift(); // Remove oldest command
      }
      
      // Execute the last command
      this.executeCommand(client, lastCommand);
      
      return;
    }

    // Check for shortcut commands
    // Single quote shortcut for say: 'hello -> say hello
    if (cleanInput.startsWith("'") && cleanInput.length > 1) {
      const text = cleanInput.substring(1);
      this.addToHistory(client, `say ${text}`);
      const sayCommand = this.commands.get('say');
      if (sayCommand) {
        sayCommand.execute(client, text);
        writeCommandPrompt(client);
      }
      return;
    }
    
    // Double quote shortcut for yell: "hello -> yell hello
    if (cleanInput.startsWith('"') && cleanInput.length > 1) {
      const text = cleanInput.substring(1);
      this.addToHistory(client, `yell ${text}`);
      const yellCommand = this.commands.get('yell');
      if (yellCommand) {
        yellCommand.execute(client, text);
        writeCommandPrompt(client);
      }
      return;
    }

    // Add the normal command to history
    this.addToHistory(client, cleanInput);

    // Execute the command
    this.executeCommand(client, cleanInput);
  }

  // Helper method to add commands to history
  private addToHistory(client: ConnectedClient, command: string): void {
    if (!client.user) return;

    // Initialize command history if it doesn't exist
    if (!client.user.commandHistory) {
      client.user.commandHistory = [];
    }

    // Add command to history
    client.user.commandHistory.push(command);
    
    // Keep only the most recent 30 commands
    if (client.user.commandHistory.length > 30) {
      client.user.commandHistory.shift(); // Remove oldest command
    }
    
    // Reset history browsing state
    client.user.currentHistoryIndex = -1;
    client.user.savedCurrentCommand = '';
  }

  // New helper method to execute a command
  private executeCommand(client: ConnectedClient, commandText: string): void {
    const parts = commandText.split(' ');
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
