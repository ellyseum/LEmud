import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient, writeMessageToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { formatUsername } from '../../utils/formatters';
import { RoomManager } from '../../room/roomManager';

export class YellCommand implements Command {
  name = 'yell';
  description = 'Yell a message that can be heard in adjacent rooms';
  private roomManager: RoomManager;

  constructor(private clients: Map<string, ConnectedClient>) {
    // Use singleton instance
    this.roomManager = RoomManager.getInstance(clients);
  }

  execute(client: ConnectedClient, args: string): void {
    // Check for forced transitions before processing command
    if (client.stateData.forcedTransition) {
      return;
    }

    // Early return if user is not defined
    if (!client.user) {
      writeToClient(client, colorize(`You must be logged in to yell.\r\n`, 'red'));
      return;
    }
    
    // Store user info in local variables to avoid null check issues
    const username = client.user.username;
    const currentRoomId = client.user.currentRoomId || this.roomManager.getStartingRoomId();

    if (!args.trim()) {
      writeToClient(client, colorize('Yell what?\r\n', 'yellow'));
      return;
    }

    // Get current room
    const currentRoom = this.roomManager.getRoom(currentRoomId);

    if (!currentRoom) {
      writeToClient(client, colorize(`You're not in a valid room.\r\n`, 'red'));
      return;
    }

    // Collect all adjacent room IDs
    const adjacentRoomIds: string[] = [];
    currentRoom.exits.forEach(exit => {
      const nextRoomId = exit.roomId;
      if (nextRoomId && !adjacentRoomIds.includes(nextRoomId)) {
        adjacentRoomIds.push(nextRoomId);
      }
    });

    // Let the yeller know what they yelled
    writeToClient(client, colorize(`You yell '${args}'!\r\n`, 'red'));

    // Send message to all clients in current room
    this.sendMessageToRoom(currentRoomId, username, args, false);

    // Send message to all clients in adjacent rooms
    for (const roomId of adjacentRoomIds) {
      this.sendMessageToRoom(roomId, username, args, true);
    }
  }

  private sendMessageToRoom(roomId: string, yellerUsername: string, message: string, isAdjacent: boolean): void {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return;

    // Get all players in the room
    for (const playerUsername of room.players) {
      // Skip the yeller in their own room
      if (!isAdjacent && playerUsername.toLowerCase() === yellerUsername.toLowerCase()) continue;
      
      // Find the client for this player
      const playerClient = this.findClientByUsername(playerUsername);
      if (playerClient) {
        // For adjacent rooms, indicate it came from somewhere else
        const messageText = isAdjacent
          ? `You hear ${formatUsername(yellerUsername)} yell '${message}'!\r\n`
          : `${formatUsername(yellerUsername)} yells '${message}'!\r\n`;
          
        writeMessageToClient(playerClient, colorize(messageText, 'red'));
      }
    }
  }

  /**
   * Find a client by username
   */
  private findClientByUsername(username: string): ConnectedClient | undefined {
    for (const [_, client] of this.clients.entries()) {
      if (client.user && client.user.username.toLowerCase() === username.toLowerCase()) {
        return client;
      }
    }
    return undefined;
  }
}
