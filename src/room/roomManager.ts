import fs from 'fs';
import path from 'path';
import { Room, Exit, Currency } from './room';
import { ConnectedClient } from '../types';
import { colorize } from '../utils/colors';
import { writeToClient } from '../utils/socketWriter';
import { writeCommandPrompt } from '../utils/promptFormatter';
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

  constructor() {
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

    // Remove player from current room
    currentRoom.removePlayer(client.user.username);

    // Add player to new room
    nextRoom.addPlayer(client.user.username);

    // Update user's current room
    client.user.currentRoomId = nextRoomId;

    writeToClient(client, colorize(`Moving...\r\n`, 'green'));
    
    // Show the new room description
    writeToClient(client, colorize(nextRoom.getDescription(), 'cyan'));
    
    return true;
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

    let description = colorize(room.shortDescription, 'cyan') + '\r\n';
    description += colorize(room.longDescription, 'white') + '\r\n';

    // Add currency description if there's any
    if (room.currency.gold > 0 || room.currency.silver > 0 || room.currency.copper > 0) {
      const currencyParts = [];
      if (room.currency.gold > 0) {
        currencyParts.push(`${room.currency.gold} gold piece${room.currency.gold === 1 ? '' : 's'}`);
      }
      if (room.currency.silver > 0) {
        currencyParts.push(`${room.currency.silver} silver piece${room.currency.silver === 1 ? '' : 's'}`);
      }
      if (room.currency.copper > 0) {
        currencyParts.push(`${room.currency.copper} copper piece${room.currency.copper === 1 ? '' : 's'}`);
      }
      
      let currencyText = currencyParts.join(', ');
      if (currencyParts.length > 1) {
        const lastPart = currencyParts.pop();
        currencyText = `${currencyParts.join(', ')}, and ${lastPart}`;
      }
      
      description += colorize(`You notice ${currencyText} here.`, 'green') + '\r\n';
    }

    // Add objects description
    if (room.objects.length > 0) {
      if (room.objects.length === 1) {
        description += colorize(`You see a ${room.objects[0]}.`, 'green') + '\r\n';
      } else {
        const lastObject = room.objects[room.objects.length - 1];
        const otherObjects = room.objects.slice(0, -1).map(obj => `a ${obj}`).join(', ');
        description += colorize(`You see ${otherObjects}, and a ${lastObject}.`, 'green') + '\r\n';
      }
    }

    // Add players and NPCs
    const entities = [
      ...room.players.map(player => colorize(formatUsername(player), 'brightMagenta')),
      ...room.npcs.map(npc => colorize(`a ${npc}`, 'magenta'))
    ];
    
    if (entities.length > 0) {
      description += colorize(`Also here: ${entities.join(', ')}.`, 'magenta') + '\r\n';
    }

    // Add exits
    if (room.exits.length > 0) {
      const directions = room.exits.map(exit => exit.direction);
      description += colorize(`Obvious exits: ${directions.join(', ')}.`, 'green') + '\r\n';
    } else {
      description += colorize('There are no obvious exits.', 'green') + '\r\n';
    }

    writeToClient(client, description);
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

    let description = colorize(room.shortDescription, 'cyan') + '\r\n';

    // Add currency description if there's any
    if (room.currency.gold > 0 || room.currency.silver > 0 || room.currency.copper > 0) {
      const currencyParts = [];
      if (room.currency.gold > 0) {
        currencyParts.push(`${room.currency.gold} gold piece${room.currency.gold === 1 ? '' : 's'}`);
      }
      if (room.currency.silver > 0) {
        currencyParts.push(`${room.currency.silver} silver piece${room.currency.silver === 1 ? '' : 's'}`);
      }
      if (room.currency.copper > 0) {
        currencyParts.push(`${room.currency.copper} copper piece${room.currency.copper === 1 ? '' : 's'}`);
      }
      
      let currencyText = currencyParts.join(', ');
      if (currencyParts.length > 1) {
        const lastPart = currencyParts.pop();
        currencyText = `${currencyParts.join(', ')}, and ${lastPart}`;
      }
      
      description += colorize(`You notice ${currencyText} here.`, 'green') + '\r\n';
    }

    // Add objects description
    if (room.objects.length > 0) {
      if (room.objects.length === 1) {
        description += colorize(`You see a ${room.objects[0]}.`, 'green') + '\r\n';
      } else {
        const lastObject = room.objects[room.objects.length - 1];
        const otherObjects = room.objects.slice(0, -1).map(obj => `a ${obj}`).join(', ');
        description += colorize(`You see ${otherObjects}, and a ${lastObject}.`, 'green') + '\r\n';
      }
    }

    // Add players and NPCs
    const entities = [
      ...room.players.map(player => colorize(formatUsername(player), 'brightMagenta')),
      ...room.npcs.map(npc => colorize(`a ${npc}`, 'magenta'))
    ];
    
    if (entities.length > 0) {
      description += colorize(`Also here: ${entities.join(', ')}.`, 'magenta') + '\r\n';
    }

    // Add exits
    if (room.exits.length > 0) {
      const directions = room.exits.map(exit => exit.direction);
      description += colorize(`Obvious exits: ${directions.join(', ')}.`, 'green') + '\r\n';
    } else {
      description += colorize('There are no obvious exits.', 'green') + '\r\n';
    }

    writeToClient(client, description);
    return true;
  }
}
