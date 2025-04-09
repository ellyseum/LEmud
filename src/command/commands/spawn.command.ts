import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';
import { NPC, NPCData } from '../../combat/npc';

export class SpawnCommand implements Command {
  name = 'spawn';
  description = 'Spawn an NPC in the current room';
  
  // Cached NPC data to avoid reloading the file for each spawn command
  private npcData: Map<string, NPCData>;

  constructor(private roomManager: RoomManager) {
    // Load NPC data when the command is created
    this.npcData = NPC.loadNPCData();
  }

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
    let npcType = parts[0] || ''; // No default, require specification
    let count = 1; // Default to 1

    // Show available NPCs if no type specified
    if (!npcType) {
      this.showAvailableNPCs(client);
      return;
    }

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

    // Check if the requested NPC exists in our data
    if (!this.npcData.has(npcType)) {
      writeToClient(client, colorize(`Unknown NPC type: ${npcType}. Use "spawn" without arguments to see available NPCs.\r\n`, 'yellow'));
      return;
    }

    // Create the specified number of NPCs
    const npcTemplate = this.npcData.get(npcType)!;
    
    for (let i = 0; i < count; i++) {
      // Create a new NPC in the room using the template
      const npc = NPC.fromNPCData(npcTemplate);
      
      // Add the NPC to the room
      room.addNPC(npcType);
      
      // Store NPC in room manager 
      const npcId = `${npcType}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      this.roomManager.storeNPC(npcId, npc);
    }

    // Update the room
    this.roomManager.updateRoom(room);

    // Notify the player
    const message = count === 1 
      ? `You have spawned a ${npcType} in the room.\r\n`
      : `You have spawned ${count} ${npcType}s in the room.\r\n`;
    
    writeToClient(client, colorize(message, 'green'));
    
    // If the spawned NPC is hostile, warn the player
    if (npcTemplate.isHostile) {
      writeToClient(client, colorize(`Warning: The ${npcType} is hostile and may attack players in the room!\r\n`, 'red'));
    }
  }

  // Helper method to show available NPC types
  private showAvailableNPCs(client: ConnectedClient): void {
    writeToClient(client, colorize('Available NPCs to spawn:\r\n', 'cyan'));
    
    if (this.npcData.size === 0) {
      writeToClient(client, colorize('No NPCs defined in the system.\r\n', 'yellow'));
      return;
    }
    
    const npcList: string[] = [];
    
    this.npcData.forEach((data, id) => {
      const hostileTag = data.isHostile ? ' (hostile)' : '';
      npcList.push(`- ${id}${hostileTag}: ${data.description.substring(0, 50)}...`);
    });
    
    writeToClient(client, colorize(npcList.join('\r\n') + '\r\n', 'white'));
    writeToClient(client, colorize('\r\nUsage: spawn <npc_type> [count]\r\n', 'cyan'));
  }
}
