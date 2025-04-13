import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient, writeFormattedMessageToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { CombatSystem } from '../../combat/combatSystem';
import { RoomManager } from '../../room/roomManager';
import { systemLogger, getPlayerLogger } from '../../utils/logger'; // Import our loggers

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
      systemLogger.warn(`Unauthenticated user ${client.id} attempted attack command`);
      writeFormattedMessageToClient(client, colorize(`You must be logged in to attack.\r\n`, 'red'));
      return;
    }
    
    // Get player logger for this user
    const playerLogger = getPlayerLogger(client.user.username);
    
    // Check if player is unconscious
    if (client.user.isUnconscious) {
      playerLogger.info(`Attack command rejected: Player is unconscious`);
      writeFormattedMessageToClient(client, colorize(`You are unconscious and cannot attack.\r\n`, 'red'));
      return;
    }
    
    // Check if combat system is unavailable
    if (!this.combatSystem) {
      systemLogger.error(`Combat system unavailable for player ${client.user.username}`);
      writeFormattedMessageToClient(client, colorize(`Combat system is currently unavailable.\r\n`, 'red'));
      return;
    }
    
    // Get current room
    const roomId = client.user.currentRoomId || this.roomManager.getStartingRoomId();
    
    // If no target specified
    if (!args.trim()) {
      playerLogger.info(`Attack command: No target specified`);
      writeFormattedMessageToClient(client, colorize(`Attack what?\r\n`, 'yellow'));
      return;
    }
    
    // Find target in the room - first try to get exact NPC by instance ID
    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      playerLogger.info(`Attack command: Invalid room ${roomId}`);
      writeFormattedMessageToClient(client, colorize(`You are not in a valid location to attack from.\r\n`, 'red'));
      return;
    }
    
    let target = null;
    const targetName = args.trim().toLowerCase();
    
    // First try direct instance ID match
    if (room.npcs.has(targetName)) {
      target = room.npcs.get(targetName);
      playerLogger.info(`Attack command: Found direct match for instance ID ${targetName}`);
    } 
    // Then try by instance ID with partial match
    else {
      const npcsInRoom = Array.from(room.npcs.values());
      const matchByInstanceId = npcsInRoom.find(npc => 
        npc.instanceId.toLowerCase().includes(targetName)
      );
      
      if (matchByInstanceId) {
        target = matchByInstanceId;
        playerLogger.info(`Attack command: Found partial instance ID match: ${matchByInstanceId.instanceId}`);
      }
      // If no instance ID match, try template ID
      else {
        const matchByTemplateId = npcsInRoom.find(npc => 
          npc.templateId.toLowerCase() === targetName ||
          npc.templateId.toLowerCase().includes(targetName)
        );
        
        if (matchByTemplateId) {
          target = matchByTemplateId;
          playerLogger.info(`Attack command: Found template ID match: ${matchByTemplateId.templateId} with instance ID: ${matchByTemplateId.instanceId}`);
        }
        // Finally try by name
        else {
          const matchByName = npcsInRoom.find(npc => 
            npc.name.toLowerCase() === targetName || 
            npc.name.toLowerCase().includes(targetName)
          );
          
          if (matchByName) {
            target = matchByName;
            playerLogger.info(`Attack command: Found name match: ${matchByName.name} with instance ID: ${matchByName.instanceId}`);
          }
        }
      }
    }
    
    if (!target) {
      playerLogger.info(`Attack command: Target "${args.trim()}" not found in room ${roomId}`);
      writeFormattedMessageToClient(client, colorize(`You don't see a '${args.trim()}' here to attack.\r\n`, 'yellow'));
      return;
    }
    
    // If already in combat, add the new target 
    if (client.user.inCombat) {
      playerLogger.info(`Attack command: Adding target ${target.name} (ID: ${target.instanceId}) to existing combat in room ${roomId}`);
      // Add this target to the existing combat
      this.combatSystem.engageCombat(client, target);
      return;
    }
    
    // Engage in combat with the target
    playerLogger.info(`Attack command: Initiating combat with ${target.name} (ID: ${target.instanceId}) in room ${roomId}`);
    const success = this.combatSystem.engageCombat(client, target);
    
    // Log success/failure
    if (!success) {
      playerLogger.warn(`Attack command: Failed to engage combat with ${target.name} (ID: ${target.instanceId})`);
      writeFormattedMessageToClient(client, colorize(`Unable to engage combat with ${target.name}.\r\n`, 'red'));
    }
  }
}
