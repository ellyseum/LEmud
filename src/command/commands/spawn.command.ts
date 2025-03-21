import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';
import { NPC } from '../../combat/npc';

export class SpawnCommand implements Command {
  name = 'spawn';
  description = 'Spawn a new enemy in the room (currently only cats)';

  constructor(private roomManager: RoomManager) {}

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    // Get current room
    const roomId = client.user.currentRoomId;
    const room = this.roomManager.getRoom(roomId);
    
    if (!room) {
      writeToClient(client, colorize(`You're not in a valid room.\r\n`, 'red'));
      return;
    }

    // Parse args to determine what to spawn and how many
    const parts = args.trim().toLowerCase().split(' ');
    const creature = parts[0] || 'cat'; // Default to cat if no creature specified
    let count = 1; // Default to 1

    // If we have a second parameter and it's a number, use it as count
    if (parts.length > 1) {
      const parsedCount = parseInt(parts[1]);
      if (!isNaN(parsedCount) && parsedCount > 0 && parsedCount <= 10) {
        count = parsedCount;
      } else {
        writeToClient(client, colorize(`Invalid count. Please specify a number between 1 and 10.\r\n`, 'yellow'));
        return;
      }
    }

    // Currently only support spawning cats
    if (creature !== 'cat') {
      writeToClient(client, colorize(`Sorry, only cats can be spawned for now.\r\n`, 'yellow'));
      return;
    }

    // Create the specified number of cat NPCs
    for (let i = 0; i < count; i++) {
      // Create a new cat NPC in the room
      const catNPC = new NPC('cat', 20, 20, [1, 3], false, false, 100);
      
      // Add the NPC to the room
      room.addNPC('cat');
      
      // Store NPC in room manager 
      const npcId = `cat-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      this.roomManager.storeNPC(npcId, catNPC);
    }

    // Update the room
    this.roomManager.updateRoom(room);

    // Notify the player
    writeToClient(
      client, 
      colorize(`You have spawned ${count} ${creature}${count !== 1 ? 's' : ''} in the room.\r\n`, 'green')
    );
  }
}
