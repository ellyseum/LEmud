import { ConnectedClient } from '../types';
import { Command } from './command.interface';
import { colorize } from '../utils/colors';
import { writeToClient } from '../utils/socketWriter';
import { UserManager } from '../user/userManager';
import { RoomManager } from '../room/roomManager';
import { CombatSystem } from '../combat/combatSystem';

// Command imports
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
import { SpawnCommand } from './commands/spawn.command';

export class CommandRegistry {
  private commands: Map<string, Command> = new Map();
  private aliases: Map<string, string> = new Map();

  constructor(
    private clients: Map<string, ConnectedClient>,
    private roomManager: RoomManager,
    private combatSystem: CombatSystem,
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
      new QuitCommand(this.userManager, this.clients),
      new LookCommand(this.clients),
      new MoveCommand(this.clients),
      new InventoryCommand(),
      new PickupCommand(this.clients, this.userManager),
      new DropCommand(this.clients, this.userManager),
      new GetCommand(this.clients, this.userManager),
      new YellCommand(this.clients),
      new HistoryCommand(),
      new AttackCommand(this.combatSystem, this.roomManager),
      new BreakCommand(this.combatSystem),
      new SpawnCommand(this.roomManager)
    ];
    
    // Register all commands
    commands.forEach(cmd => {
      this.commands.set(cmd.name, cmd);
    });
    
    // Register aliases
    this.registerAliases();
    
    // Register direction shortcuts
    this.registerDirectionCommands();
    
    // Help command needs access to all commands, so add it last
    const helpCommand = new HelpCommand(this.commands);
    this.commands.set(helpCommand.name, helpCommand);
  }

  private registerAliases(): void {
    this.aliases.set('l', 'look');
    this.aliases.set('i', 'inventory');
    this.aliases.set('inv', 'inventory');
    this.aliases.set('hist', 'history');
    this.aliases.set('take', 'pickup');
    this.aliases.set('a', 'attack');
    this.aliases.set('br', 'break');
    this.aliases.set('sp', 'spawn');
  }

  private registerDirectionCommands(): void {
    const moveCommand = this.commands.get('move');
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
  }

  public getCommand(name: string): Command | undefined {
    // First try to get the command directly
    let command = this.commands.get(name);
    
    // If not found, check aliases
    if (!command && this.aliases.has(name)) {
      const aliasedName = this.aliases.get(name);
      if (aliasedName) {
        command = this.commands.get(aliasedName);
      }
    }
    
    return command;
  }

  public showAvailableCommands(client: ConnectedClient): void {
    writeToClient(client, colorize(`=== Available Commands ===\n`, 'boldCyan'));
    
    // Get unique commands (excluding direction shortcuts)
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
    
    // Display each command and its description
    for (const [name, command] of sortedCommands) {
      writeToClient(client, colorize(`${name} - ${command.description}\n`, 'cyan'));
    }
    
    writeToClient(client, colorize(`==========================\n`, 'boldCyan'));
  }
}
