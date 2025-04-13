import { ConnectedClient } from '../../types';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';
import { CombatSystem } from '../../combat/combatSystem';
import { UserManager } from '../../user/userManager';
import { colorize } from '../../utils/colors';
import { writeFormattedMessageToClient } from '../../utils/socketWriter';
import { getPlayerLogger } from '../../utils/logger';

export class MoveCommand implements Command {
  name = 'move';
  description = 'Move in a direction (north, south, east, west, etc.)';
  private roomManager: RoomManager;
  private combatSystem: CombatSystem;

  constructor(clients: Map<string, ConnectedClient>) {
    // Use singleton instances
    this.roomManager = RoomManager.getInstance(clients);
    const userManager = UserManager.getInstance();
    this.combatSystem = CombatSystem.getInstance(userManager, this.roomManager);
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) {
      writeFormattedMessageToClient(client, colorize(`You must be logged in to move.\r\n`, 'red'));
      return;
    }
    
    const playerLogger = getPlayerLogger(client.user.username);
    
    // Check if the player is in a valid room first
    this.roomManager.teleportToStartingRoomIfNeeded(client);
    
    const direction = args.trim().toLowerCase();
    
    if (!direction) {
      return;
    }

    // Get current room info before moving
    const currentRoomId = client.user.currentRoomId || this.roomManager.getStartingRoomId();
    const currentRoom = this.roomManager.getRoom(currentRoomId);
    const currentRoomName = currentRoom ? currentRoom.name : "unknown location";

    // Log player's attempt to move
    playerLogger.info(`Attempting to move ${direction} from room ${currentRoomId} (${currentRoomName})`);

    // Simply proceed with movement regardless of combat state
    // Combat system will handle checking rooms during next tick
    const success = this.roomManager.movePlayer(client, direction);
    
    // Log the result of movement attempt
    if (success && client.user.currentRoomId !== currentRoomId) {
      const newRoom = this.roomManager.getRoom(client.user.currentRoomId);
      const newRoomName = newRoom ? newRoom.name : "unknown location";
      playerLogger.info(`Successfully moved ${direction} to room ${client.user.currentRoomId} (${newRoomName})`);
    } else if (!success) {
      playerLogger.info(`Failed to move ${direction} - no exit available`);
    }
  }
}
