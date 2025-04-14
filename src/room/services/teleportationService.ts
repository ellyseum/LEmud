import { ITeleportationService } from '../interfaces';
import { ConnectedClient } from '../../types';
import { Room } from '../room';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { formatUsername } from '../../utils/formatters';
import { systemLogger, getPlayerLogger } from '../../utils/logger';

export class TeleportationService implements ITeleportationService {
  private roomManager: {
    getRoom: (roomId: string) => Room | undefined;
    getStartingRoomId: () => string;
    getAllRooms: () => Room[];
  };
  private notifyPlayersInRoom: (roomId: string, message: string, excludeUsername?: string) => void;

  constructor(
    roomManager: { 
      getRoom: (roomId: string) => Room | undefined;
      getStartingRoomId: () => string;
      getAllRooms: () => Room[];
    },
    notifyPlayersInRoom: (roomId: string, message: string, excludeUsername?: string) => void
  ) {
    this.roomManager = roomManager;
    this.notifyPlayersInRoom = notifyPlayersInRoom;
  }

  /**
   * Remove a player from all rooms (used when logging in to ensure player is only in one room)
   */
  public removePlayerFromAllRooms(username: string): void {
    const rooms = this.roomManager.getAllRooms();
    for (const room of rooms) {
      room.removePlayer(username);
    }
  }

  /**
   * Teleports a player to the starting room if they're in an invalid room
   * @param client The connected client
   * @returns true if teleport was needed and successful, false otherwise
   */
  public teleportToStartingRoomIfNeeded(client: ConnectedClient): boolean {
    if (!client.user) return false;

    // Check if the player is in a valid room
    const currentRoomId = client.user.currentRoomId;
    if (currentRoomId && this.roomManager.getRoom(currentRoomId)) {
      // Player is in a valid room, no need to teleport
      return false;
    }

    // Player is in an invalid room, teleport them to the starting room
    return this.teleportToStartingRoom(client);
  }

  /**
   * Forcefully teleports a player to the starting room
   * @param client The connected client
   * @returns true if teleport was successful, false otherwise
   */
  public teleportToStartingRoom(client: ConnectedClient): boolean {
    if (!client.user) return false;

    const startingRoomId = this.roomManager.getStartingRoomId();
    const startingRoom = this.roomManager.getRoom(startingRoomId);

    if (!startingRoom) {
      systemLogger.error("Error: Starting room does not exist!");
      return false;
    }

    // Remove the player from any room they might be in
    this.removePlayerFromAllRooms(client.user.username);
    // Add the player to the starting room
    startingRoom.addPlayer(client.user.username);
    // Update the player's current room ID
    client.user.currentRoomId = startingRoomId;

    // Notify the player about the teleport
    writeToClient(client, colorize(`You are being teleported to a safe location...\r\n`, 'yellow'));
    
    // Show the new room description
    writeToClient(client, startingRoom.getDescriptionExcludingPlayer(client.user.username));
    
    // Announce player's arrival in the starting room
    this.notifyPlayersInRoom(
      startingRoomId,
      `${formatUsername(client.user.username)} suddenly appears in a flash of light!\r\n`,
      client.user.username
    );

    // Log the teleportation
    const playerLogger = getPlayerLogger(client.user.username);
    playerLogger.info(`Teleported to starting room: ${startingRoom.name}`);
    
    return true;
  }
}