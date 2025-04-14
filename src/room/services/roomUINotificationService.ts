// filepath: /Users/jelden/projects/game/src/room/services/roomUINotificationService.ts
import { IRoomUINotificationService } from '../interfaces';
import { ConnectedClient } from '../../types';
import { Room } from '../room';
import { colorize } from '../../utils/colors';
import { writeToClient, writeFormattedMessageToClient } from '../../utils/socketWriter';
import { formatUsername } from '../../utils/formatters';
import { systemLogger, getPlayerLogger } from '../../utils/logger';

export class RoomUINotificationService implements IRoomUINotificationService {
  private roomManager: {
    getRoom: (roomId: string) => Room | undefined;
    getStartingRoomId: () => string;
  };
  private findClientByUsername: (username: string) => ConnectedClient | undefined;
  private teleportService: {
    teleportToStartingRoom: (client: ConnectedClient) => boolean;
  };

  constructor(
    roomManager: {
      getRoom: (roomId: string) => Room | undefined;
      getStartingRoomId: () => string;
    },
    findClientByUsername: (username: string) => ConnectedClient | undefined,
    teleportService: {
      teleportToStartingRoom: (client: ConnectedClient) => boolean;
    }
  ) {
    this.roomManager = roomManager;
    this.findClientByUsername = findClientByUsername;
    this.teleportService = teleportService;
  }

  /**
   * Show room description to player
   */
  public lookRoom(client: ConnectedClient): boolean {
    if (!client.user) return false;

    // Get current room
    const roomId = client.user.currentRoomId || this.roomManager.getStartingRoomId();
    const room = this.roomManager.getRoom(roomId);

    if (!room) {
      writeFormattedMessageToClient(client, colorize(`You seem to be lost in the void. Teleporting to safety...\r\n`, 'red'));
      return this.teleportService.teleportToStartingRoom(client);
    }

    // Use the Room's method for consistent formatting with formatted message writer
    writeToClient(client, room.getDescriptionExcludingPlayer(client.user.username));
    return true;
  }

  /**
   * Brief look that omits the long description
   */
  public briefLookRoom(client: ConnectedClient): boolean {
    if (!client.user) return false;

    // Get current room
    const roomId = client.user.currentRoomId || this.roomManager.getStartingRoomId();
    const room = this.roomManager.getRoom(roomId);

    if (!room) {
      writeFormattedMessageToClient(client, colorize(`You seem to be lost in the void. Teleporting to safety...\r\n`, 'red'));
      return this.teleportService.teleportToStartingRoom(client);
    }

    // Use the Room's brief description method with formatted message writer
    writeToClient(client, room.getBriefDescriptionExcludingPlayer(client.user.username));
    return true;
  }

  /**
   * Helper method to notify all players in a room about something
   */
  public notifyPlayersInRoom(roomId: string, message: string, excludeUsername?: string): void {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return;

    for (const playerName of room.players) {
      // Skip excluded player if specified
      if (excludeUsername && playerName.toLowerCase() === excludeUsername.toLowerCase()) {
        continue;
      }
      
      const playerClient = this.findClientByUsername(playerName);
      if (playerClient) {
        writeFormattedMessageToClient(playerClient, message);
      }
    }
  }

  /**
   * Announce a player's entrance to a room to all other players in that room
   */
  public announcePlayerEntrance(roomId: string, username: string): void {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return;
    
    // Announce to all other players in the room that this player has entered
    this.notifyPlayersInRoom(
      roomId,
      `${formatUsername(username)} enters the room.\r\n`,
      username // Exclude the player themselves
    );

    // Log the player's entrance
    systemLogger.info(`Player ${username} entered room ${roomId}`);
    const playerLogger = getPlayerLogger(username);
    playerLogger.info(`Entered room ${roomId}: ${room.name}`);
  }
}