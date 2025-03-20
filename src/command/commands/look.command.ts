import { ConnectedClient } from '../../types';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';
import { colorize } from '../../utils/colors';
import { writeToClient, writeMessageToClient } from '../../utils/socketWriter';
import { formatUsername } from '../../utils/formatters';

export class LookCommand implements Command {
  name = 'look';
  description = 'Look at your surroundings, in a direction, or at a specific object';
  aliases = ['l', 'examine', 'ex'];
  private roomManager: RoomManager;

  constructor(private clients: Map<string, ConnectedClient>) {
    // Use singleton instance
    this.roomManager = RoomManager.getInstance(clients);
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    // If no arguments, look at the current room
    if (!args.trim()) {
      // Look at the current room
      this.roomManager.lookRoom(client);
      
      // Notify other players in the room that this player is looking around
      this.notifyLookingAround(client);
      return;
    }

    // Check if the argument is a direction
    const direction = this.parseDirection(args.trim().toLowerCase());
    if (direction) {
      this.lookInDirection(client, direction);
      return;
    }

    // Check for "look at/in/on [entity]" patterns and extract entity name
    let entityName = args.trim();
    const prepositionMatch = args.match(/^(?:at|in|on)\s+(.+)$/i);
    if (prepositionMatch) {
      // If a preposition was used, extract just the entity name
      entityName = prepositionMatch[1].trim();
    }

    // Look at the entity (whether or not a preposition was used)
    this.roomManager.lookAtEntity(client, entityName);
  }

  private parseDirection(input: string): string | null {
    const directions = [
      'north', 'south', 'east', 'west', 'up', 'down',
      'northeast', 'northwest', 'southeast', 'southwest',
      'n', 's', 'e', 'w', 'u', 'd', 'ne', 'nw', 'se', 'sw'
    ];

    if (directions.includes(input)) {
      return input;
    }

    return null;
  }

  private lookInDirection(client: ConnectedClient, direction: string): void {
    if (!client.user) return;

    // Get current room
    const roomId = client.user.currentRoomId || this.roomManager.getStartingRoomId();
    const room = this.roomManager.getRoom(roomId);

    if (!room) {
      writeToClient(client, colorize(`You're not in a valid room.\r\n`, 'red'));
      return;
    }

    // Check if exit exists
    const nextRoomId = room.getExit(direction);
    if (!nextRoomId) {
      writeToClient(client, colorize(`You don't see anything special in that direction.\r\n`, 'yellow'));
      return;
    }

    // Get destination room
    const nextRoom = this.roomManager.getRoom(nextRoomId);
    if (!nextRoom) {
      writeToClient(client, colorize(`You can't see anything in that direction.\r\n`, 'yellow'));
      return;
    }

    // Get the full direction name for messages
    const fullDirectionName = this.getFullDirectionName(direction);

    writeToClient(client, colorize(`You look ${fullDirectionName}...\r\n`, 'cyan'));

    // Get the opposite direction for the proper "looking from" message
    const oppositeDirection = this.getOppositeDirection(direction);
    
    // Notify other players in the current room that this player is looking in a direction
    this.notifyPlayersInCurrentRoom(roomId, client.user.username, fullDirectionName);
    
    // Notify players in the target room that someone is peeking in
    this.notifyPlayersInTargetRoom(nextRoomId, client.user.username, this.getFullDirectionName(oppositeDirection));
    
    // Show a version of the room description specifically for peeking
    writeToClient(client, nextRoom.getDescriptionForPeeking(oppositeDirection));
  }

  /**
   * Notify other players in the current room that someone is looking in a direction
   */
  private notifyPlayersInCurrentRoom(roomId: string, username: string, direction: string): void {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return;
    
    for (const playerName of room.players) {
      // Skip the player who is looking
      if (playerName.toLowerCase() === username.toLowerCase()) continue;
      
      const playerClient = this.findClientByUsername(playerName);
      if (playerClient) {
        writeMessageToClient(
          playerClient,
          colorize(`${formatUsername(username)} looks to the ${direction}.\r\n`, 'cyan')
        );
      }
    }
  }

  /**
   * Notify players in the target room that someone is peeking in
   */
  private notifyPlayersInTargetRoom(roomId: string, username: string, fromDirection: string): void {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return;
    
    for (const playerName of room.players) {
      const playerClient = this.findClientByUsername(playerName);
      if (playerClient) {
        writeMessageToClient(
          playerClient,
          colorize(`${formatUsername(username)} peeks into the room from the ${fromDirection}.\r\n`, 'cyan')
        );
      }
    }
  }

  /**
   * Notify other players in the room that someone is looking around
   */
  private notifyLookingAround(client: ConnectedClient): void {
    if (!client.user) return;
    
    const roomId = client.user.currentRoomId || this.roomManager.getStartingRoomId();
    const room = this.roomManager.getRoom(roomId);
    if (!room) return;
    
    for (const playerName of room.players) {
      // Skip the player who is looking
      if (playerName.toLowerCase() === client.user.username.toLowerCase()) continue;
      
      const playerClient = this.findClientByUsername(playerName);
      if (playerClient) {
        writeMessageToClient(
          playerClient,
          colorize(`${formatUsername(client.user.username)} looks around the room.\r\n`, 'cyan')
        );
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

  private formatExits(exits: any[]): string {
    if (exits.length === 0) {
      return 'none';
    }

    return exits.map(exit => exit.direction).join(', ');
  }

  /**
   * Get the opposite direction of movement
   */
  private getOppositeDirection(direction: string): string {
    switch (direction.toLowerCase()) {
      case 'north': return 'south';
      case 'south': return 'north';
      case 'east': return 'west';
      case 'west': return 'east';
      case 'up': return 'below';
      case 'down': return 'above';
      case 'northeast': return 'southwest';
      case 'northwest': return 'southeast';
      case 'southeast': return 'northwest';
      case 'southwest': return 'northeast';
      // Handle abbreviations too
      case 'n': return 'south';
      case 's': return 'north';
      case 'e': return 'west';
      case 'w': return 'east';
      case 'ne': return 'southwest';
      case 'nw': return 'southeast';
      case 'se': return 'northwest';
      case 'sw': return 'northeast';
      case 'u': return 'below';
      case 'd': return 'above';
      default: return 'somewhere';
    }
  }

  /**
   * Convert direction abbreviation to full name
   */
  private getFullDirectionName(direction: string): string {
    switch (direction.toLowerCase()) {
      case 'n': return 'north';
      case 's': return 'south';
      case 'e': return 'east';
      case 'w': return 'west';
      case 'ne': return 'northeast';
      case 'nw': return 'northwest';
      case 'se': return 'southeast';
      case 'sw': return 'southwest';
      case 'u': return 'up';
      case 'd': return 'down';
      default: return direction.toLowerCase(); // Return the original if it's already a full name
    }
  }
}
