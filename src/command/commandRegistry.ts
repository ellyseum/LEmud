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
import { EquipCommand } from './commands/equip.command';
import { UnequipCommand } from './commands/unequip.command';
import { EquipmentCommand } from './commands/equipment.command';
import { GiveItemCommand } from './commands/giveitem.command';
import { SudoCommand } from './commands/sudo.command';

export class CommandRegistry {
  private commands: Map<string, Command>;
  private aliases: Map<string, {commandName: string, args?: string}>;

  constructor(
    private clients: Map<string, ConnectedClient>,
    private roomManager: RoomManager,
    private combatSystem: CombatSystem,
    private userManager: UserManager
  ) {
    this.commands = new Map<string, Command>();
    this.aliases = new Map<string, {commandName: string, args?: string}>();
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
      new SpawnCommand(this.roomManager),
      new EquipCommand(),
      new UnequipCommand(),
      new EquipmentCommand(),
      new GiveItemCommand(this.userManager),
      new SudoCommand(this.userManager)
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
    this.aliases.set('l', {commandName: 'look'});
    this.aliases.set('i', {commandName: 'inventory'});
    this.aliases.set('inv', {commandName: 'inventory'});
    this.aliases.set('hist', {commandName: 'history'});
    this.aliases.set('take', {commandName: 'pickup'});
    this.aliases.set('a', {commandName: 'attack'});
    this.aliases.set('br', {commandName: 'break'});
    this.aliases.set('sp', {commandName: 'spawn'});
    this.aliases.set('st', {commandName: 'stats'});
    this.aliases.set('stat', {commandName: 'stats'});
    this.aliases.set('eq', {commandName: 'equip'});
    this.aliases.set('uneq', {commandName: 'unequip'});
    this.aliases.set('remove', {commandName: 'unequip'});
    this.aliases.set('gear', {commandName: 'equipment'});
    this.aliases.set('worn', {commandName: 'equipment'});
    this.aliases.set('equips', {commandName: 'equipment'});
    this.aliases.set('gi', {commandName: 'giveitem'});
  }

  private registerDirectionCommands(): void {
    const directions = ['north', 'south', 'east', 'west', 'up', 'down', 'northeast', 'northwest', 'southeast', 'southwest'];
    const shortDirections = ['n', 's', 'e', 'w', 'u', 'd', 'ne', 'nw', 'se', 'sw'];

    // Register direction commands as aliases/shortcuts to the move command
    for (const dir of directions) {
      this.registerAlias(dir, 'move', dir);
      console.log(`Registered direction alias: ${dir} -> move ${dir}`);
    }

    for (const shortDir of shortDirections) {
      const fullDir = this.convertShortToFullDirection(shortDir);
      this.registerAlias(shortDir, 'move', fullDir);
      console.log(`Registered short direction alias: ${shortDir} -> move ${fullDir}`);
    }
  }

  /**
   * Register an alias for a command
   */
  public registerAlias(alias: string, commandName: string, args?: string): void {
    this.aliases.set(alias, { commandName, args });
  }

  private convertShortToFullDirection(shortDir: string): string {
    switch (shortDir) {
      case 'n': return 'north';
      case 's': return 'south';
      case 'e': return 'east';
      case 'w': return 'west';
      case 'u': return 'up';
      case 'd': return 'down';
      case 'ne': return 'northeast';
      case 'nw': return 'northwest';
      case 'se': return 'southeast';
      case 'sw': return 'southwest';
      default: return shortDir;  // If not recognized, return as is
    }
  }

  /**
   * Check if a command is a direction command
   */
  public isDirectionCommand(name: string): boolean {
    const directions = ['north', 'south', 'east', 'west', 'up', 'down', 'northeast', 'northwest', 'southeast', 'southwest'];
    const shortDirections = ['n', 's', 'e', 'w', 'u', 'd', 'ne', 'nw', 'se', 'sw'];
    
    return directions.includes(name) || shortDirections.includes(name);
  }

  public getCommand(name: string): Command | undefined {
    // First try to get the command directly
    let command = this.commands.get(name);
    
    // If not found, check aliases
    if (!command && this.aliases.has(name)) {
      const aliasedName = this.aliases.get(name)?.commandName;
      if (aliasedName) {
        command = this.commands.get(aliasedName);
      }
    }
        
    return command;
  }

  public showAvailableCommands(client: ConnectedClient): void {
    writeToClient(client, colorize(`=== Available Commands ===\n`, 'boldCyan'));
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

  /**
   * Execute a command with the given input
   */
  public executeCommand(client: ConnectedClient, input: string): void {
    const [commandName, ...args] = input.split(' ');
    const lowercaseCommand = commandName.toLowerCase();
    
    // Special case for direction commands
    if (this.isDirectionCommand(lowercaseCommand)) {
      const moveCommand = this.commands.get('move');
      if (moveCommand) {
        try {
          // If it's a shorthand (n, s, e, w), convert to full direction
          const direction = this.convertShortToFullDirection(lowercaseCommand);
          moveCommand.execute(client, direction);
        } catch (err: unknown) {
          console.error(`Error executing direction command ${lowercaseCommand}:`, err);
          if (err instanceof Error) {
            writeToClient(client, colorize(`Error moving: ${err.message}\r\n`, 'red'));
          } else {
            writeToClient(client, colorize(`Error moving\r\n`, 'red'));
          }
        }
        return;
      }
    }

    // Handle regular commands
    const command = this.getCommand(lowercaseCommand);

    if (command) {
      try {
        command.execute(client, args.join(' '));
      } catch (err: unknown) {
        console.error(`Error executing command ${commandName}:`, err);
        if (err instanceof Error) {
          writeToClient(client, colorize(`Error executing command: ${err.message}\r\n`, 'red'));
        } else {
          writeToClient(client, colorize(`Error executing command\r\n`, 'red'));
        }
      }
      return;
    }

    const alias = this.aliases.get(lowercaseCommand);
    if (alias) {
      const aliasCommand = this.commands.get(alias.commandName);
      if (aliasCommand) {
        try {
          const aliasArgs = alias.args ? alias.args : args.join(' ');
          aliasCommand.execute(client, aliasArgs.trim());
        } catch (err: unknown) {
          console.error(`Error executing alias ${commandName}:`, err);
          if (err instanceof Error) {
            writeToClient(client, colorize(`Error executing command: ${err.message}\r\n`, 'red'));
          } else {
            writeToClient(client, colorize(`Error executing command\r\n`, 'red'));
          }
        }
        return;
      }
    }
    
    // If we got here, the command wasn't found
    writeToClient(client, colorize(`Unknown command: ${commandName}\r\n`, 'yellow'));
    
    // Get the help command and execute it to show available commands
    const helpCommand = this.getCommand('help');
    if (helpCommand) {
      helpCommand.execute(client, '');
    }
  }
  
  /**
   * Get all registered commands
   * This is used for admin commands like sudo to check authorization
   */
  public getAllCommands(): Map<string, Command> {
    return this.commands;
  }
  
  /**
   * Get the sudo command instance, or undefined if not available
   */
  public getSudoCommand(): SudoCommand | undefined {
    const sudoCommand = this.getCommand('sudo');
    return sudoCommand instanceof SudoCommand ? sudoCommand : undefined;
  }
}