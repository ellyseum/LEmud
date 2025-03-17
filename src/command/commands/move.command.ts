import { ConnectedClient } from '../../types';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';

export class MoveCommand implements Command {
  name = 'move';
  description = 'Move in a direction (north, south, east, west, etc.)';
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

  constructor(private roomManager: RoomManager) {}

  execute(client: ConnectedClient, args: string): void {
    const direction = args.trim().toLowerCase();
    
    if (!direction) {
      return;
    }

    this.roomManager.movePlayer(client, direction);
  }
}
