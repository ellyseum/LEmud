import { ConnectedClient } from '../../types';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';

export class MoveCommand implements Command {
  name = 'move';
  description = 'Move in a direction (north, south, east, west, etc.)';
  private roomManager: RoomManager;

  constructor(clients: Map<string, ConnectedClient>) {
    // Use singleton instance
    this.roomManager = RoomManager.getInstance(clients);
  }

  execute(client: ConnectedClient, args: string): void {
    const direction = args.trim().toLowerCase();
    
    if (!direction) {
      return;
    }

    this.roomManager.movePlayer(client, direction);
  }
}
