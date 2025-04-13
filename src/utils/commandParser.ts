import { createContextLogger } from './logger';
import { ConnectedClient } from '../types';

// Create a context-specific logger for CommandParser
const parserLogger = createContextLogger('CommandParser');

export interface ParsedCommand {
  command: string;
  args: string[];
}

export class CommandParser {
  constructor(private client: ConnectedClient) {}

  /**
   * Parse a command and return the command and arguments
   */
  parse(input: string): ParsedCommand {
    // Safely handle empty input
    if (!input || input.trim() === '') {
      // For players in combat, we'll interpret an empty input as an attack command
      // This allows players to just press Enter to attack during combat
      if (this.client.user && this.client.user.inCombat) {
        parserLogger.debug(`Converting empty input to attack command for player in combat`);
        return {
          command: 'attack',
          args: []
        };
      }
      
      return {
        command: '',
        args: []
      };
    }
    
    const parts = input.trim().split(/\s+/);
    const command = parts.shift()?.toLowerCase() || '';
    const args = parts;

    return {
      command,
      args
    };
  }
}