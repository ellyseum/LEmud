import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { CombatSystem } from '../../combat/combatSystem';
import { RoomManager } from '../../room/roomManager';

export class AttackCommand implements Command {
  name = 'attack';
  description = 'Attack an enemy to engage in combat';

  constructor(
    private combatSystem: CombatSystem,
    private roomManager: RoomManager
  ) {}

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    const targetName = args.trim().toLowerCase();
    
    if (!targetName) {
      writeToClient(client, colorize(`Attack what?\r\n`, 'yellow'));
      return;
    }

    // Get the client's current room
    const currentRoomId = client.user.currentRoomId;
    
    // Look for an NPC with that name in the room
    const npc = this.roomManager.getNPCFromRoom(currentRoomId, targetName);
    
    if (npc) {
      // Set the user's combat status
      client.user.inCombat = true;
      
      // Engage combat with the NPC
      this.combatSystem.engageCombat(client, npc);
      
      // The combat system will now handle combat messages
    } else {
      writeToClient(client, colorize(`You don't see a '${targetName}' here to attack.\r\n`, 'yellow'));
    }
  }
}
