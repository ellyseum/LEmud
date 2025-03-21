import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient, writeFormattedMessageToClient } from '../../utils/socketWriter';
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
    // Early return if user is not defined
    if (!client.user) {
      writeFormattedMessageToClient(client, colorize(`You must be logged in to attack.\r\n`, 'red'));
      return;
    }
    
    // Get current room
    const roomId = client.user.currentRoomId || this.roomManager.getStartingRoomId();
    
    // If no target specified
    if (!args.trim()) {
      writeFormattedMessageToClient(client, colorize(`Attack what?\r\n`, 'yellow'));
      return;
    }
    
    // Find target in the room
    const target = this.roomManager.getNPCFromRoom(roomId, args.trim());
    if (!target) {
      writeFormattedMessageToClient(client, colorize(`You don't see a '${args.trim()}' here to attack.\r\n`, 'yellow'));
      return;
    }
    
    // If already in combat, add the new target 
    if (client.user.inCombat) {
      // Add this target to the existing combat
      this.combatSystem.engageCombat(client, target);
      return;
    }
    
    // Engage in combat with the target
    const success = this.combatSystem.engageCombat(client, target);
    
    // Log success/failure
    if (!success) {
      writeFormattedMessageToClient(client, colorize(`Unable to engage combat with ${target.name}.\r\n`, 'red'));
    }
  }
}
