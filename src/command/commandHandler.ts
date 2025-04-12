import { ConnectedClient } from '../types';
import { colorize } from '../utils/colors';
import { writeToClient, drawCommandPrompt } from '../utils/socketWriter';
import { UserManager } from '../user/userManager';
import { RoomManager } from '../room/roomManager';
import { CombatSystem } from '../combat/combatSystem';
import { CommandRegistry } from './commandRegistry';
import { GameTimerManager } from '../timer/gameTimerManager';
import { StateMachine } from '../state/stateMachine'; // Add StateMachine import
// Import the commands index file to ensure all commands are registered
import './commands';

export class CommandHandler {
  private commands: CommandRegistry;
  private historySize = 30;
  // Commands that unconscious players cannot use
  private restrictedCommandsWhileUnconscious = [
    'move', 'attack', 'north', 'south', 'east', 'west', 
    'northeast', 'northwest', 'southeast', 'southwest',
    'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'up', 'down', 'u', 'd',
    'spawn', 'get', 'pickup', 'drop'
  ];

  constructor(
    private clients: Map<string, ConnectedClient>,
    private userManager: UserManager,
    private roomManager?: RoomManager,
    private combatSystem?: CombatSystem,
    private stateMachine?: StateMachine // Add StateMachine parameter
  ) {
    // Get the room manager instance
    const roomMgr = this.roomManager || RoomManager.getInstance(this.clients);
    
    // Get or create the combat system
    const combatSys = this.combatSystem || 
      (GameTimerManager.getInstance(this.userManager, roomMgr)?.getCombatSystem() || 
      CombatSystem.getInstance(this.userManager, roomMgr));
    
    // Get the singleton instance of CommandRegistry instead of creating a new one
    this.commands = CommandRegistry.getInstance(
      this.clients,
      roomMgr,
      combatSys,
      this.userManager,
      this.stateMachine // Pass the StateMachine instance
    );
  }

  public handleCommand(client: ConnectedClient, input: string): void {
    if (!client.user) return;

    // Ensure input is trimmed
    const cleanInput = input.trim();
    
    // Skip empty commands and don't add them to history
    if (cleanInput === '') {
      // Do a brief look when user hits enter with no command
      if (this.roomManager) {
        this.roomManager.briefLookRoom(client);
      }
      drawCommandPrompt(client);
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
        drawCommandPrompt(client);
        return;
      }

      // Get the most recent command
      const lastCommand = client.user.commandHistory[client.user.commandHistory.length - 1];
      
      // Display what we're executing
      writeToClient(client, colorize(`Repeating: ${lastCommand}\r\n`, 'dim'));
      
      // Add the repeated command to history
      client.user.commandHistory.push(lastCommand);
      
      // Keep only the most recent 30 commands
      if (client.user.commandHistory.length > this.historySize) {
        client.user.commandHistory.shift(); // Remove oldest command
      }
      
      // Execute the last command
      this.executeCommand(client, lastCommand);
      
      return;
    }

    // Add the command to history first (unless it contains "password")
    if (!cleanInput.toLowerCase().includes('password')) {
      this.addToHistory(client, cleanInput);
    }

    // Now handle shortcuts and execute the command
    this.handleShortcuts(client, cleanInput);
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
    
    // Keep only the most recent commands
    if (client.user.commandHistory.length > this.historySize) {
      client.user.commandHistory.shift(); // Remove oldest command
    }
    
    // Reset history browsing state
    client.user.currentHistoryIndex = -1;
    client.user.savedCurrentCommand = '';
  }

  // Handle command shortcuts
  private handleShortcuts(client: ConnectedClient, input: string): void {
    // Single quote shortcut for say: 'hello -> say hello
    if (input.startsWith("'") && input.length > 1) {
      const text = input.substring(1);
      this.executeCommand(client, `say ${text}`);
      return;
    }
    
    // Double quote shortcut for yell: "hello -> yell hello
    if (input.startsWith('"') && input.length > 1) {
      const text = input.substring(1);
      this.executeCommand(client, `yell ${text}`);
      return;
    }
    
    // No shortcuts matched, execute as normal command
    this.executeCommand(client, input);
  }

  // Execute a command with arguments
  private executeCommand(client: ConnectedClient, commandText: string): void {
    const parts = commandText.split(' ');
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ').trim(); // Also trim arguments

    // Check if player is unconscious and trying to use a restricted command
    if (client.user && client.user.isUnconscious && this.isRestrictedWhileUnconscious(commandName)) {
      writeToClient(client, colorize('You are unconscious and cannot perform that action.\r\n', 'red'));
      drawCommandPrompt(client);
      return;
    }

    // Special case for directional movement shortcuts (n, s, e, w, etc.)
    if (this.commands.isDirectionCommand(commandName)) {
      this.commands.executeCommand(client, commandText);
      drawCommandPrompt(client);
      return;
    }

    // Find and execute command
    const command = this.commands.getCommand(commandName);
    
    if (command) {
      command.execute(client, args);
      
      // Display the command prompt after command execution
      // (many commands will draw the prompt themselves, but this ensures it always happens)
      drawCommandPrompt(client);
    } else {
      // Use the CommandRegistry to handle unknown commands
      // This will show the "Unknown command" message and display the help command
      this.commands.executeCommand(client, commandText);
      
      // Display the command prompt after
      drawCommandPrompt(client);
    }
  }
  
  // Check if a command is restricted for unconscious players
  private isRestrictedWhileUnconscious(commandName: string): boolean {
    return this.restrictedCommandsWhileUnconscious.includes(commandName.toLowerCase());
  }
}
