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

    // Format yell text: convert to uppercase and add exclamation mark if needed
    let yellText = args.toUpperCase();
    if (!yellText.endsWith('!')) {
      yellText += '!';
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
    writeToClient(client, colorize(`You yell '${yellText}'!\r\n`, 'red'));

    // Send message to all clients in current room
    this.sendMessageToRoom(currentRoomId, username, yellText, false);

    // Send message to all clients in adjacent rooms
    for (const roomId of adjacentRoomIds) {
      // Find the direction from the adjacent room to the current room
      const directionFromAdjacent = this.getDirectionBetweenRooms(roomId, currentRoomId);
      this.sendMessageToRoom(roomId, username, yellText, true, directionFromAdjacent);
    }
  }

  private sendMessageToRoom(
    roomId: string, 
    yellerUsername: string, 
    message: string, 
    isAdjacent: boolean,
    fromDirection?: string
  ): void {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return;

    // Get all players in the room
    for (const playerUsername of room.players) {
      // Skip the yeller in their own room
      if (!isAdjacent && playerUsername.toLowerCase() === yellerUsername.toLowerCase()) continue;
      
      // Find the client for this player
      const playerClient = this.findClientByUsername(playerUsername);
      if (playerClient) {
        // Message format depends on whether the player is in the same room or adjacent
        let messageText;
        if (isAdjacent) {
          messageText = fromDirection 
            ? `You hear someone yell from the ${fromDirection} '${message}'\r\n`
            : `You hear someone yell '${message}'\r\n`;
        } else {
          messageText = `${formatUsername(yellerUsername)} yells '${message}'\r\n`;
        }
          
        writeMessageToClient(playerClient, colorize(messageText, 'red'));
      }
    }
  }

  /**
   * Find the direction from one room to another based on exits
   */
  private getDirectionBetweenRooms(fromRoomId: string, toRoomId: string): string | undefined {
    const fromRoom = this.roomManager.getRoom(fromRoomId);
    if (!fromRoom) return undefined;
    
    // Find the exit that leads to the target room
    for (const exit of fromRoom.exits) {
      if (exit.roomId === toRoomId) {
        return exit.direction;
      }
    }
    return undefined;
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
