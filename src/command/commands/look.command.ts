import { ConnectedClient } from '../../types';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';

export class LookCommand implements Command {
  name = 'look';
  description = 'Look at your surroundings or in a direction';
  private roomManager: RoomManager;
  private directionAliases: { [key: string]: string } = {
    'n': 'north',
    's': 'south',
    'e': 'east',
    'w': 'west',
    'ne': 'northeast',
    'nw': 'northwest',
    'se': 'southeast',
    'sw': 'southwest',
    'u': 'up',
    'd': 'down'
  };

  constructor(clients: Map<string, ConnectedClient>) {
    // Use singleton instance
    this.roomManager = RoomManager.getInstance(clients);
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    // If no arguments, look at the current room
    if (!args.trim()) {
      this.roomManager.lookRoom(client);
      return;
    }

    // Check if the argument is a direction
    const direction = args.trim().toLowerCase();
    const fullDirection = this.directionAliases[direction] || direction;
    
    // Check if this is a valid direction to look
    if (this.isDirection(fullDirection)) {
      // Look in that direction
      this.roomManager.lookIntoRoom(client, fullDirection);
      return;
    }

    // If we get here, the player tried to look at something else
    // For now, just look at the room and add a message
    writeToClient(client, colorize(`You don't see any '${args}' here.\r\n`, 'yellow'));
    this.roomManager.lookRoom(client);
  }

  private isDirection(direction: string): boolean {
    const validDirections = [
      'north', 'south', 'east', 'west',
      'northeast', 'northwest', 'southeast', 'southwest',
      'up', 'down'
    ];
    return validDirections.includes(direction);
  }
}
