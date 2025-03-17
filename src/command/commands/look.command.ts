import { ConnectedClient } from '../../types';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';

export class LookCommand implements Command {
  name = 'look';
  description = 'Look at your surroundings';

  constructor(private roomManager: RoomManager) {}

  execute(client: ConnectedClient, args: string): void {
    // If no arguments, look at the room
    if (!args.trim()) {
      this.roomManager.lookRoom(client);
      return;
    }

    // TODO: Implement looking at specific objects in the room
    // For now, just default to looking at the room
    this.roomManager.lookRoom(client);
  }
}
