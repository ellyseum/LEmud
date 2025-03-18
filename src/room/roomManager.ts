import fs from 'fs';
import path from 'path';
import { Room, Exit, Currency } from './room';
import { ConnectedClient } from '../types';
import { colorize } from '../utils/colors';
import { writeToClient, writeMessageToClient } from '../utils/socketWriter';
import { formatUsername } from '../utils/formatters';

const ROOMS_FILE = path.join(__dirname, '..', '..', 'data', 'rooms.json');
const DEFAULT_ROOM_ID = 'start'; // ID for the starting room

interface RoomData {
  id: string;
  shortDescription: string;
  longDescription: string;
  exits: Exit[];
  objects: string[];
  npcs: string[];
  currency: Currency;
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private clients: Map<string, ConnectedClient>;

  constructor(clients: Map<string, ConnectedClient>) {
    this.clients = clients;
    this.loadRooms();
    this.ensureStartingRoom();
  }

  private loadRooms(): void {
    try {
      if (fs.existsSync(ROOMS_FILE)) {
        const data = fs.readFileSync(ROOMS_FILE, 'utf8');
        const roomDataArray: RoomData[] = JSON.parse(data);
        
        roomDataArray.forEach(roomData => {
          const room = new Room({
            id: roomData.id,
            shortDescription: roomData.shortDescription,
            longDescription: roomData.longDescription,
            exits: roomData.exits || [],
            objects: roomData.objects || [],
            npcs: roomData.npcs || [],
            players: [], // Players are tracked at runtime, not saved
            currency: roomData.currency || { gold: 0, silver: 0, copper: 0 }
          });
          
          this.rooms.set(room.id, room);
        });
      } else {
        // Create initial rooms file if it doesn't exist
        this.saveRooms();
      }
    } catch (error) {
      console.error('Error loading rooms:', error);
      this.ensureStartingRoom(); // Make sure we have at least the starting room
    }
  }

  private saveRooms(): void {
    try {
      // Convert rooms to storable format (without players)
      const roomsData = Array.from(this.rooms.values()).map(room => ({
        id: room.id,
        shortDescription: room.shortDescription,
        longDescription: room.longDescription,
        exits: room.exits,
        objects: room.objects,
        npcs: room.npcs,
        currency: room.currency
      }));
      
      fs.writeFileSync(ROOMS_FILE, JSON.stringify(roomsData, null, 2));
    } catch (error) {
      console.error('Error saving rooms:', error);
    }
  }

  private ensureStartingRoom(): void {
    if (!this.rooms.has(DEFAULT_ROOM_ID)) {
      // Create a default starting room if none exists
      const startingRoom = new Room({
        id: DEFAULT_ROOM_ID,
        shortDescription: 'The Starting Room',
        longDescription: 'You are in the starting room. It is small and musty and smells like old clothes and cheese.',
        exits: [{ direction: 'north', roomId: 'room2' }],
        objects: ['sword', 'shield'],
        npcs: ['dog', 'cat'],
        currency: { gold: 5, silver: 3, copper: 10 }
      });
      
      // Create a second room to demonstrate movement
      const secondRoom = new Room({
        id: 'room2',
        shortDescription: 'A New Room',
        longDescription: 'You are in a new room.',
        exits: [{ direction: 'south', roomId: DEFAULT_ROOM_ID }],
        objects: [],
        npcs: []
      });
      
      this.rooms.set(startingRoom.id, startingRoom);
      this.rooms.set(secondRoom.id, secondRoom);
      this.saveRooms();
    }
  }

  public getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  public addRoomIfNotExists(room: Room): void {
    if (!this.rooms.has(room.id)) {
      this.rooms.set(room.id, room);
      this.saveRooms();
    }
  }

  public updateRoom(room: Room): void {
    this.rooms.set(room.id, room);
    this.saveRooms();
  }

  public getStartingRoomId(): string {
    return DEFAULT_ROOM_ID;
  }

  // Move a player to a new room
  public movePlayer(client: ConnectedClient, direction: string): boolean {
    if (!client.user) return false;

    // Get current room
    const currentRoomId = client.user.currentRoomId || this.getStartingRoomId();
    const currentRoom = this.getRoom(currentRoomId);

    if (!currentRoom) {
      writeToClient(client, colorize(`You're not in a valid room.\r\n`, 'red'));
      return false;
    }

    // Check if exit exists
    const nextRoomId = currentRoom.getExit(direction);
    if (!nextRoomId) {
      writeToClient(client, colorize(`There is no exit in that direction.\r\n`, 'red'));
      return false;
    }

    // Get destination room
    const nextRoom = this.getRoom(nextRoomId);
    if (!nextRoom) {
      writeToClient(client, colorize(`The destination room doesn't exist.\r\n`, 'red'));
      return false;
    }

    // Get the full direction name for messages
    const fullDirectionName = this.getFullDirectionName(direction);
    
    // Get the opposite direction for the arrival message
    const oppositeDirection = this.getOppositeDirection(direction);
    const fullOppositeDirectionName = this.getFullDirectionName(oppositeDirection);
    
    // Notify players in current room that this player is leaving
    this.notifyPlayersInRoom(
      currentRoomId,
      `${formatUsername(client.user.username)} leaves ${fullDirectionName}.\r\n`,
      client.user.username
    );

    // Remove player from current room
    currentRoom.removePlayer(client.user.username);

    // Add player to new room
    nextRoom.addPlayer(client.user.username);
    
    // Notify players in the destination room that this player arrived
    this.notifyPlayersInRoom(
      nextRoomId, 
      `${formatUsername(client.user.username)} enters from the ${fullOppositeDirectionName}.\r\n`,
      client.user.username
    );

    // Update user's current room
    client.user.currentRoomId = nextRoomId;

    writeToClient(client, colorize(`Moving...\r\n`, 'green'));
    
    // Show the new room description - use the Room's method for consistent formatting
    writeToClient(client, nextRoom.getDescriptionExcludingPlayer(client.user.username));
    
    return true;
  }

  /**
   * Remove a player from all rooms (used when logging in to ensure player is only in one room)
   */
  public removePlayerFromAllRooms(username: string): void {
    for (const [_, room] of this.rooms.entries()) {
      room.removePlayer(username);
    }
  }

  /**
   * Notifies all players in a room with a message, excluding the specified player
   */
  private notifyPlayersInRoom(roomId: string, message: string, excludeUsername?: string): void {
    const room = this.getRoom(roomId);
    if (!room) return;
    
    // Get all players in the room
    for (const playerUsername of room.players) {
      // Skip the excluded player if any
      if (excludeUsername && playerUsername === excludeUsername) continue;
      
      // Find the client for this player
      const client = this.findClientByUsername(playerUsername);
      if (client) {
        writeMessageToClient(client, colorize(message, 'cyan'));
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

  // Show room description to player
  public lookRoom(client: ConnectedClient): boolean {
    if (!client.user) return false;

    // Get current room
    const roomId = client.user.currentRoomId || this.getStartingRoomId();
    const room = this.getRoom(roomId);

    if (!room) {
      writeToClient(client, colorize(`You're not in a valid room.\r\n`, 'red'));
      return false;
    }

    // Use the Room's method for consistent formatting
    writeToClient(client, room.getDescriptionExcludingPlayer(client.user.username));
    return true;
  }

  // Brief look that omits the long description
  public briefLookRoom(client: ConnectedClient): boolean {
    if (!client.user) return false;

    // Get current room
    const roomId = client.user.currentRoomId || this.getStartingRoomId();
    const room = this.getRoom(roomId);

    if (!room) {
      writeToClient(client, colorize(`You're not in a valid room.\r\n`, 'red'));
      return false;
    }

    // Use the Room's brief description method for consistent formatting
    writeToClient(client, room.getBriefDescriptionExcludingPlayer(client.user.username));
    return true;
  }
}
