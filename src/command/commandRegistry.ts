import { ConnectedClient } from '../types';
import { Command } from './command.interface';
import { colorize } from '../utils/colors';
import { writeToClient } from '../utils/socketWriter';
import { UserManager } from '../user/userManager';
import { RoomManager } from '../room/roomManager';
import { CombatSystem } from '../combat/combatSystem';
import { createContextLogger } from '../utils/logger';

// Create a context-specific logger for CommandRegistry
const commandLogger = createContextLogger('CommandRegistry');

// Command imports
import { SayCommand } from './commands/say.command';
import { ListCommand } from './commands/list.command';
import { StatsCommand } from './commands/stats.command';
import { HealCommand } from './commands/heal.command';
import { DamageCommand } from './commands/damage.command';
import { EffectCommand } from './commands/effect.command'; // Import our new Effect command
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
import { AdminManageCommand } from './commands/adminmanage.command';
import { SnakeCommand } from './commands/snake.command';
import { WaitCommand } from './commands/wait.command'; // Import our new Wait command
import { ScoresCommand } from './commands/scores.command';
import { DebugCommand } from './commands/debug.command'; // Import our new Debug command
import { RestrictCommand } from './commands/restrict.command'; // Import our new Restrict command
import { RootCommand } from './commands/root.command'; // Import our new Root command
import { AddFlagCommand } from './commands/addflag.command'; // Import our new AddFlag command
import { RemoveFlagCommand } from './commands/removeflag.command'; // Import our new RemoveFlag command
import { ListFlagsCommand } from './commands/listflags.command'; // Import our new ListFlags command
import { DestroyCommand } from './commands/destroy.command'; // Import our new Destroy command
import { RenameCommand } from './commands/rename.command'; // Updated to match the constructor definition of RenameCommand
import { ResetNameCommand } from './commands/resetname.command'; // Import our new Reset Name command
import { RepairCommand } from './commands/repair.command'; // Import our new Repair command
import { BugReportCommand } from './commands/bugreport.command';
import { ChangePasswordCommand } from './commands/changePassword.command'; // Import our new ChangePassword command
import { PlayedCommand } from './commands/played.command'; // Import our new Played command
import { TimeCommand } from './commands/time.command'; // Import our new Time command

// Function to calculate Levenshtein distance between two strings
function levenshteinDistance(a: string, b: string): number {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

  for (let i = 0; i <= a.length; i += 1) {
    matrix[0][i] = i;
  }

  for (let j = 0; j <= b.length; j += 1) {
    matrix[j][0] = j;
  }

  for (let j = 1; j <= b.length; j += 1) {
    for (let i = 1; i <= a.length; i += 1) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, // deletion
        matrix[j - 1][i] + 1, // insertion
        matrix[j - 1][i - 1] + indicator, // substitution
      );
    }
  }

  return matrix[b.length][a.length];
}

export class CommandRegistry {
  private commands: Map<string, Command>;
  private aliases: Map<string, {commandName: string, args?: string}>;
  
  // Add static instance for singleton pattern
  private static instance: CommandRegistry | null = null;

  // Make constructor private for singleton pattern
  private constructor(
    private clients: Map<string, ConnectedClient>,
    private roomManager: RoomManager,
    private combatSystem: CombatSystem,
    private userManager: UserManager,
    private stateMachine: any // Add StateMachine instance
  ) {
    this.commands = new Map<string, Command>();
    this.aliases = new Map<string, {commandName: string, args?: string}>();
    this.registerCommands();
  }
  
  // Static method to get the singleton instance
  public static getInstance(
    clients: Map<string, ConnectedClient>,
    roomManager: RoomManager,
    combatSystem: CombatSystem,
    userManager: UserManager,
    stateMachine: any // Add StateMachine instance
  ): CommandRegistry {
    if (!CommandRegistry.instance) {
      commandLogger.info('Creating CommandRegistry instance');
      CommandRegistry.instance = new CommandRegistry(clients, roomManager, combatSystem, userManager, stateMachine);
    } else {
      // Update references if they've changed
      CommandRegistry.instance.clients = clients;
      CommandRegistry.instance.roomManager = roomManager;
      CommandRegistry.instance.combatSystem = combatSystem;
      CommandRegistry.instance.userManager = userManager;
      CommandRegistry.instance.stateMachine = stateMachine;
    }
    return CommandRegistry.instance;
  }
  
  // Method to reset the singleton instance (useful for testing or server restart)
  public static resetInstance(): void {
    CommandRegistry.instance = null;
  }

  private registerCommands(): void {
    // Create command instances
    const snakeCommand = new SnakeCommand(this.stateMachine); // Pass StateMachine instance
    const waitCommand = new WaitCommand(this.stateMachine); // Pass StateMachine instance for our new WaitCommand
    const commands: Command[] = [
      new SayCommand(this.clients),
      new ListCommand(this.clients),
      new StatsCommand(),
      new HealCommand(this.userManager),
      new DamageCommand(this.userManager),
      new EffectCommand(this.userManager, this.roomManager), // Add our new Effect command
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
      new BreakCommand(this.combatSystem, this.userManager),
      new SpawnCommand(this.roomManager),
      new EquipCommand(),
      new UnequipCommand(),
      new EquipmentCommand(),
      new GiveItemCommand(this.userManager),
      // Use SudoCommand singleton instance without passing userManager
      SudoCommand.getInstance(),
      new AdminManageCommand(this.userManager),
      snakeCommand, // Add SnakeCommand instance
      waitCommand, // Add WaitCommand instance
      new ScoresCommand(), // Add ScoresCommand instance
      new DebugCommand(this.roomManager, this.userManager, this.combatSystem), // Add our new Debug command
      new RestrictCommand(this.userManager), // Add our new Restrict command
      new RootCommand(this.userManager, this.roomManager), // Add our new Root command
      new AddFlagCommand(this.userManager), // Add our new flag management commands
      new RemoveFlagCommand(this.userManager),
      new ListFlagsCommand(this.userManager),
      new DestroyCommand(this.clients), // Add our new Destroy command
      new RenameCommand(), // Updated to match the constructor definition of RenameCommand
      new ResetNameCommand(), // Add our new ResetName command
      new RepairCommand(), // Add our new Repair command
      new BugReportCommand(this.userManager), // Add our new Bug Report command
      new ChangePasswordCommand(this.userManager), // Add our new ChangePassword command
      new PlayedCommand(this.userManager), // Add our new Played command
      new TimeCommand() // Add our new Time command
    ];
    
    // Register all commands
    commands.forEach(cmd => {
      this.commands.set(cmd.name, cmd);
    });
    
    // Connect SudoCommand and AdminManageCommand
    const sudoCommand = commands.find(cmd => cmd.name === 'sudo') as SudoCommand;
    const adminManageCommand = commands.find(cmd => cmd.name === 'adminmanage') as AdminManageCommand;
    const bugReportCommand = commands.find(cmd => cmd.name === 'bugreport') as BugReportCommand;
    
    if (sudoCommand && adminManageCommand) {
      adminManageCommand.setSudoCommand(sudoCommand);
      // Provide the command registry to SudoCommand so it can execute other commands
      sudoCommand.setCommandRegistry(this);
    }
    
    // Connect BugReportCommand to SudoCommand for admin permission checking
    if (sudoCommand && bugReportCommand) {
      bugReportCommand.setSudoCommand(sudoCommand);
    }
    
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
    this.aliases.set('rem', {commandName: 'unequip'}); // Add 'rem' as shortcut for 'remove'/'unequip'
    this.aliases.set('gear', {commandName: 'equipment'});
    this.aliases.set('worn', {commandName: 'equipment'});
    this.aliases.set('equips', {commandName: 'equipment'});
    this.aliases.set('gi', {commandName: 'giveitem'});
    this.aliases.set('admin', {commandName: 'adminmanage'});
    this.aliases.set('admins', {commandName: 'adminmanage', args: 'list'});
    // Add aliases for effects command
    this.aliases.set('eff', {commandName: 'effect'});
    this.aliases.set('effs', {commandName: 'effect', args: 'list'});
    // Add aliases for scores command
    this.aliases.set('highscores', {commandName: 'scores'});
    this.aliases.set('leaderboard', {commandName: 'scores'});
    // Add aliases for debug command
    this.aliases.set('dbg', {commandName: 'debug'});
    this.aliases.set('inspect', {commandName: 'debug'});
    this.aliases.set('dnpc', {commandName: 'debug', args: 'npc'});
    this.aliases.set('droom', {commandName: 'debug', args: 'room'});
    this.aliases.set('dplayer', {commandName: 'debug', args: 'player'});
    this.aliases.set('dsystem', {commandName: 'debug', args: 'system'});
    // Add alias for destroy command
    this.aliases.set('trash', {commandName: 'destroy'});
    this.aliases.set('delete', {commandName: 'destroy'});
    // Add aliases for rename command
    this.aliases.set('name', {commandName: 'rename'});
    this.aliases.set('label', {commandName: 'rename'});
    // Add aliases for resetname command
    this.aliases.set('originalname', {commandName: 'resetname'});
    this.aliases.set('defaultname', {commandName: 'resetname'});
    this.aliases.set('unnickname', {commandName: 'resetname'});
    // Add aliases for repair command
    this.aliases.set('fix', {commandName: 'repair'});
    this.aliases.set('mend', {commandName: 'repair'});
    // Add aliases for bug report command
    this.aliases.set('bug', {commandName: 'bugreport'});
    this.aliases.set('brp', {commandName: 'bugreport'});
    this.aliases.set('bugs', {commandName: 'bugreport', args: 'list'});
    this.aliases.set('report', {commandName: 'bugreport'});
    // Add alias for change password command
    this.aliases.set('changepass', {commandName: 'changepassword'});
    // Add alias for wait command
    this.aliases.set('wa', {commandName: 'wait'});
  }

  private registerDirectionCommands(): void {
    const directions = ['north', 'south', 'east', 'west', 'up', 'down', 'northeast', 'northwest', 'southeast', 'southwest'];
    const shortDirections = ['n', 's', 'e', 'w', 'u', 'd', 'ne', 'nw', 'se', 'sw'];

    // Register direction commands as aliases/shortcuts to the move command
    for (const dir of directions) {
      this.registerAlias(dir, 'move', dir);
      // Only log this message when verbose logging is enabled or on first initialization
      if (CommandRegistry.instance === this) {
        commandLogger.debug(`Registered direction alias: ${dir} -> move ${dir}`);
      }
    }

    for (const shortDir of shortDirections) {
      const fullDir = this.convertShortToFullDirection(shortDir);
      this.registerAlias(shortDir, 'move', fullDir);
      // Only log this message when verbose logging is enabled or on first initialization
      if (CommandRegistry.instance === this) {
        commandLogger.debug(`Registered short direction alias: ${shortDir} -> move ${fullDir}`);
      }
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
   * Find the closest command name to the given input using Levenshtein distance.
   */
  private findClosestCommand(input: string): string | null {
    let minDistance = Infinity;
    let suggestion: string | null = null;
    const threshold = 3; // Maximum allowed distance for a suggestion

    const allCommandNames = [
      ...this.commands.keys(),
      ...this.aliases.keys(),
    ];

    for (const name of allCommandNames) {
      // Skip internal/directional aliases if they match the input exactly
      if (this.isDirectionCommand(name) && name === input) continue;

      const distance = levenshteinDistance(input, name);
      if (distance < minDistance && distance <= threshold) {
        minDistance = distance;
        suggestion = name;
      }
    }

    // Don't suggest the input itself if it wasn't found
    if (suggestion === input) {
      return null;
    }

    return suggestion;
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
          commandLogger.error(`Error executing direction command ${lowercaseCommand}:`, err);
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
        commandLogger.error(`Error executing command ${commandName}:`, err);
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
          commandLogger.error(`Error executing alias ${commandName}:`, err);
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
    // Find the closest command suggestion
    const suggestion = this.findClosestCommand(lowercaseCommand);

    let message = colorize(`Command '`, 'red');
    message += colorize(commandName, 'bright');
    message += colorize(`' not recognized.`, 'red');

    if (suggestion) {
      message += colorize(` Did you mean '`, 'red');
      message += colorize(suggestion, 'bright');
      message += colorize(`'?`, 'red');
    }
    message += '\r\n'; // Newline

    message += colorize('Hint: ', 'brightWhite');
    message += colorize(`Type '`, 'yellow');
    message += colorize('help', 'bright');
    message += colorize(`' for a list of commands.`, 'yellow');
    message += '\r\n';

    writeToClient(client, message);
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
