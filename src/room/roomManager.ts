import fs from 'fs';
import path from 'path';
import { Room } from './room';
import { ConnectedClient, Currency, Exit, Item } from '../types';
import { colorize } from '../utils/colors';
import { writeToClient, writeFormattedMessageToClient, drawCommandPrompt } from '../utils/socketWriter';
import { formatUsername } from '../utils/formatters';
import { NPC } from '../combat/npc';
import { systemLogger, getPlayerLogger } from '../utils/logger';

const ROOMS_FILE = path.join(__dirname, '..', '..', 'data', 'rooms.json');
const DEFAULT_ROOM_ID = 'start'; // ID for the starting room

interface RoomData {
  id: string;
  shortDescription?: string;
  longDescription?: string;
  name?: string;
  description?: string;
  exits: Exit[];
  items?: string[];
  players?: string[];
  npcs?: string[];
  currency: Currency;
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private clients: Map<string, ConnectedClient>;
  private npcs: Map<string, NPC> = new Map();
  
  // Add static instance for singleton pattern
  private static instance: RoomManager | null = null;

  // Make constructor private for singleton pattern
  private constructor(clients: Map<string, ConnectedClient>) {
    systemLogger.info('Creating RoomManager instance');
    this.clients = clients;
    this.loadRooms();
    this.ensureStartingRoom();
  }
  
  // Static method to get the singleton instance
  public static getInstance(clients: Map<string, ConnectedClient>): RoomManager {
    if (!RoomManager.instance) {
      RoomManager.instance = new RoomManager(clients);
    } else {
      // Update clients reference if it's a different object
      RoomManager.instance.clients = clients;
    }
    return RoomManager.instance;
  }

  private loadRooms(): void {
    try {
      if (fs.existsSync(ROOMS_FILE)) {
        const data = fs.readFileSync(ROOMS_FILE, 'utf8');
        const roomDataArray: RoomData[] = JSON.parse(data);
        
        systemLogger.info(`Loading ${roomDataArray.length} rooms...`);
        
        roomDataArray.forEach(roomData => {
          const room = new Room(roomData);
          this.rooms.set(room.id, room);
        });
      } else {
        // Create initial rooms file if it doesn't exist
        this.saveRooms();
      }
    } catch (error) {
      systemLogger.error('Error loading rooms:', error);
      this.ensureStartingRoom(); // Make sure we have at least the starting room
    }

    // Add NPC initialization after loading rooms
    this.initializeNPCs();
  }

  private saveRooms(): void {
    try {
      // Convert rooms to storable format (without players)
      const roomsData = Array.from(this.rooms.values()).map(room => {
        // Convert NPC Map to an array of template IDs for storage
        const npcTemplateIds: string[] = [];
        
        // For each NPC in the room, store its template ID
        room.npcs.forEach(npc => {
          npcTemplateIds.push(npc.templateId);
        });
        
        // Serialize item instances to a format suitable for storage
        const serializedItemInstances = room.serializeItemInstances();
        
        return {
          id: room.id,
          name: room.name,
          description: room.description,
          exits: room.exits,
          items: room.items, // Keep legacy items for backward compatibility
          itemInstances: serializedItemInstances, // Add new item instances
          npcs: npcTemplateIds,  // Use the array of template IDs
          currency: room.currency
        };
      });
      
      fs.writeFileSync(ROOMS_FILE, JSON.stringify(roomsData, null, 2));
    } catch (error) {
      systemLogger.error('Error saving rooms:', error);
    }
  }

  private ensureStartingRoom(): void {
    if (!this.rooms.has(DEFAULT_ROOM_ID)) {
      // Create a default starting room if none exists
      const startingRoom = new Room({
        id: DEFAULT_ROOM_ID,
        name: 'The Starting Room',
        description: 'You are in the starting room. It is small and musty and smells like old clothes and cheese.',
        exits: [{ direction: 'north', roomId: 'room2' }],
        items: ['sword', 'shield'],
        npcs: [],
        currency: { gold: 5, silver: 3, copper: 10 }
      });
      
      // Create a second room to demonstrate movement
      const secondRoom = new Room({
        id: 'room2',
        name: 'A New Room',
        description: 'You are in a new room.',
        exits: [{ direction: 'south', roomId: DEFAULT_ROOM_ID }],
        items: [],
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

  /**
   * Calculate movement delay based on character agility
   * @param agility The player's agility stat
   * @returns Delay in milliseconds
   */
  private calculateMovementDelay(agility: number): number {
    // Base delay is 3000ms (3 seconds)
    const baseDelay = 3000;
    
    // Calculate reduction based on agility (higher agility = less delay)
    // Each point of agility reduces delay by 100ms (10% of base per 10 agility)
    const reduction = Math.min(agility * 100, baseDelay * 0.8); // Cap at 80% reduction
    
    // Return the adjusted delay (minimum 500ms)
    return Math.max(baseDelay - reduction, 500);
  }

  /**
   * Move a player to a new room with travel delay based on character speed
   * @param client The connected client
   * @param direction The direction to move
   * @returns true if movement succeeded, false otherwise
   */
  public movePlayerWithDelay(client: ConnectedClient, direction: string): boolean {
    if (!client.user) return false;

    // Check if player movement is restricted
    if (client.user.movementRestricted) {
      const reason = client.user.movementRestrictedReason || "You are unable to move.";
      writeToClient(client, colorize(`${reason}\r\n`, 'red'));
      return false;
    }

    // Get current room
    const currentRoomId = client.user.currentRoomId || this.getStartingRoomId();
    const currentRoom = this.getRoom(currentRoomId);

    if (!currentRoom) {
      writeToClient(client, colorize(`You seem to be lost in the void. Teleporting to safety...\r\n`, 'red'));
      return this.teleportToStartingRoom(client);
    }

    // Check if exit exists
    const nextRoomId = currentRoom.getExit(direction);
    if (!nextRoomId) {
      writeToClient(client, colorize(`There is no exit in that direction.\r\n`, 'red'));
      
      // Notify other players in the room about the wall collision
      // Get full direction name for the message
      const fullDirectionName = this.getFullDirectionName(direction);
      this.notifyPlayersInRoom(
        currentRoomId,
        `${formatUsername(client.user.username)} runs into a wall trying to go ${fullDirectionName}.\r\n`,
        client.user.username
      );
      
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
    
    // Notify players in current room that this player is leaving (but not yet gone)
    this.notifyPlayersInRoom(
      currentRoomId,
      `${formatUsername(client.user.username)} starts moving ${fullDirectionName}.\r\n`,
      client.user.username
    );

    // Calculate movement delay based on agility
    // Default to 10 if agility is undefined
    const agility = client.user.agility || 10;
    const delay = this.calculateMovementDelay(agility);

    // Inform player they're moving - use writeToClient instead of writeFormattedMessageToClient
    // to avoid redrawing the prompt after this message
    writeToClient(client, colorize(`Moving${delay > 1000 ? ' slowly' : ''}...\r\n`, 'green'));
    
    // Flag to prevent multiple moves while moving
    if (!client.stateData) {
      client.stateData = {};
    }
    client.stateData.isMoving = true;
    
    // Suppress the prompt until movement is complete
    client.stateData.suppressPrompt = true;
    
    // Set a timeout to perform the actual room transition after the delay
    setTimeout(() => {
      // Make sure client.user is still available when the timeout executes
      if (client.user) {
        // NOW remove the player from the old room
        currentRoom.removePlayer(client.user.username);

        // NOW add the player to the new room
        nextRoom.addPlayer(client.user.username);
        
        // NOW notify players in the old room that this player has left
        this.notifyPlayersInRoom(
          currentRoomId,
          `${formatUsername(client.user.username)} leaves ${fullDirectionName}.\r\n`,
          client.user.username
        );
        
        // NOW notify players in the destination room that this player has arrived
        this.notifyPlayersInRoom(
          nextRoomId, 
          `${formatUsername(client.user.username)} enters from the ${fullOppositeDirectionName}.\r\n`,
          client.user.username
        );

        // NOW update user's current room
        client.user.currentRoomId = nextRoomId;

        // Log the player's movement
        const playerLogger = getPlayerLogger(client.user.username);
        playerLogger.info(`Moved to room ${nextRoomId}: ${nextRoom.name}`);
        
        // Show the new room description with formatted message to redraw prompt after
        writeFormattedMessageToClient(
          client, 
          nextRoom.getDescriptionExcludingPlayer(client.user.username),
          true // Explicitly set drawPrompt to true
        );
        
        // Process any commands that were buffered during movement
        if (client.stateData.movementCommandQueue && client.stateData.movementCommandQueue.length > 0) {
          // Extract the queued commands
          const commandQueue = [...client.stateData.movementCommandQueue];
          
          // Clear the queue
          client.stateData.movementCommandQueue = [];
          
          // Process only the first command after movement is complete
          // We'll handle multiple movement commands sequentially
          setTimeout(() => {
            // Import the CommandHandler directly to avoid circular dependency issues
            const { CommandHandler } = require('../command/commandHandler');
            const userManager = require('../user/userManager').UserManager.getInstance();
            
            // Create a new instance of CommandHandler
            const commandHandler = new CommandHandler(this.clients, userManager, this);
            
            // Process only the first command in the queue
            if (commandQueue.length > 0) {
              const cmd = commandQueue.shift(); // Take the first command
              commandHandler.handleCommand(client, cmd);
              
              // If there are more commands in the queue, save them back to the client
              // They'll be processed after any resulting movement completes
              if (commandQueue.length > 0) {
                if (!client.stateData) {
                  client.stateData = {};
                }
                client.stateData.movementCommandQueue = commandQueue;
              }
            }
          }, 100);
        }
        
        // Clear the moving flags
        if (client.stateData) {
          client.stateData.isMoving = false;
          client.stateData.suppressPrompt = false;
        }
        
        // Force redraw of the prompt to ensure it appears
        drawCommandPrompt(client);
      }
    }, delay);
    
    return true;
  }

  // Original movePlayer method kept for backward compatibility
  public movePlayer(client: ConnectedClient, direction: string): boolean {
    return this.movePlayerWithDelay(client, direction);
  }

  /**
   * Get the CombatSystem instance (to avoid circular dependencies)
   */
  private getCombatSystem(): any {
    try {
      // Access the CombatSystem directly
      const { CombatSystem } = require('../combat/combatSystem');
      if (CombatSystem && CombatSystem.getInstance) {
        const { UserManager } = require('../user/userManager');
        return CombatSystem.getInstance(
          UserManager.getInstance(),
          this
        );
      }
      return null;
    } catch (err) {
      systemLogger.error('[RoomManager] Error getting CombatSystem instance:', err);
      return null;
    }
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
   * Announce a player's entrance to a room to all other players in that room
   */
  public announcePlayerEntrance(roomId: string, username: string): void {
    const room = this.getRoom(roomId);
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

  /**
   * Helper method to notify all players in a room about something
   */
  private notifyPlayersInRoom(roomId: string, message: string, excludeUsername?: string): void {
    const room = this.getRoom(roomId);
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
      writeFormattedMessageToClient(client, colorize(`You seem to be lost in the void. Teleporting to safety...\r\n`, 'red'));
      return this.teleportToStartingRoom(client);
    }

    // Use the Room's method for consistent formatting with formatted message writer
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
      writeFormattedMessageToClient(client, colorize(`You seem to be lost in the void. Teleporting to safety...\r\n`, 'red'));
      return this.teleportToStartingRoom(client);
    }

    // Use the Room's brief description method with formatted message writer
    writeToClient(client, room.getBriefDescriptionExcludingPlayer(client.user.username));
    return true;
  }

  /**
   * Examine a specific entity (item, NPC, player) in the room or inventory
   * @param client The connected client
   * @param entityName The name of the entity to examine
   * @returns true if entity was found and examined, false otherwise
   */
  public lookAtEntity(client: ConnectedClient, entityName: string): boolean {
    if (!client.user) return false;

    // Import the ItemManager
    const { ItemManager } = require('../utils/itemManager');
    const itemManager = ItemManager.getInstance();

    // Get current room
    const roomId = client.user.currentRoomId || this.getStartingRoomId();
    const room = this.getRoom(roomId);

    if (!room) {
      writeToClient(client, colorize(`You seem to be lost in the void. Teleporting to safety...\r\n`, 'red'));
      return this.teleportToStartingRoom(client);
    }

    // Normalize the entity name for easier matching
    const normalizedName = entityName.toLowerCase().trim();
    
    // NPCs are now stored in a Map, so we need to search through values
    let matchingNPC: NPC | null = null;
    
    // First try to find the NPC by instance ID
    matchingNPC = room.getNPC(entityName) || null;
    
    // If not found by ID, check if any NPC name matches
    if (!matchingNPC) {
      // Check all NPCs in the room for a name match
      const npcsInRoom = Array.from(room.npcs.values());
      for (const npc of npcsInRoom) {
        if (npc.name.toLowerCase() === normalizedName || 
            npc.name.toLowerCase().includes(normalizedName) ||
            npc.templateId.toLowerCase() === normalizedName) {
          matchingNPC = npc;
          break;
        }
      }
    }
    
    if (matchingNPC) {
      // Display NPC description with proper formatting
      writeToClient(client, colorize(`You look at the ${matchingNPC.name}.\r\n`, 'cyan'));
      if (matchingNPC.description) {
        writeToClient(client, colorize(`${matchingNPC.description}\r\n`, 'cyan'));
        
        // If it's a combat entity, show its health status
        if (matchingNPC.health > 0) {
          const healthPercentage = Math.floor((matchingNPC.health / matchingNPC.maxHealth) * 100);
          let healthStatus = '';
          
          if (healthPercentage > 90) {
            healthStatus = 'in perfect health';
          } else if (healthPercentage > 75) {
            healthStatus = 'slightly injured';
          } else if (healthPercentage > 50) {
            healthStatus = 'injured';
          } else if (healthPercentage > 25) {
            healthStatus = 'badly wounded';
          } else {
            healthStatus = 'near death';
          }
          
          writeToClient(client, colorize(`It appears to be ${healthStatus}.\r\n`, 'cyan'));
        } else {
          writeToClient(client, colorize(`It appears to be dead.\r\n`, 'red'));
        }
      } else {
        // Fallback description if not found in data
        writeToClient(client, colorize(`It's a ${matchingNPC.name} in the room with you.\r\n`, 'cyan'));
      }
      
      // Notify other players in the room
      this.notifyPlayersInRoom(
        roomId,
        `${formatUsername(client.user.username)} examines the ${matchingNPC.name} carefully.\r\n`,
        client.user.username
      );
      
      return true;
    }

    // Next, check item instances in the room - Prioritize itemInstances over legacy items
    const itemInstances = room.getItemInstances();
    let matchingItemInstance: string | null = null;
    let matchingItemTemplate: string | null = null;
    
    // Try to find an item by instance ID or name
    for (const [instanceId, templateId] of itemInstances.entries()) {
      // Direct match on instance ID
      if (instanceId === entityName) {
        matchingItemInstance = instanceId;
        matchingItemTemplate = templateId;
        break;
      }
      
      // Check if the template name matches
      const template = itemManager.getItem(templateId);
      if (template && 
          (template.name.toLowerCase() === normalizedName || 
           template.name.toLowerCase().includes(normalizedName))) {
        matchingItemInstance = instanceId;
        matchingItemTemplate = templateId;
        break;
      }
      
      // Also check for custom names in item instances
      const instance = itemManager.getItemInstance(instanceId);
      if (instance && instance.properties?.customName) {
        const customName = instance.properties.customName.toLowerCase();
        if (customName === normalizedName || customName.includes(normalizedName)) {
          matchingItemInstance = instanceId;
          matchingItemTemplate = templateId;
          break;
        }
      }
    }
    
    // If we found a matching item instance
    if (matchingItemInstance && matchingItemTemplate) {
      const template = itemManager.getItem(matchingItemTemplate);
      const instance = itemManager.getItemInstance(matchingItemInstance);
      
      if (template) {
        // Use custom name if available, otherwise template name
        const displayName = instance?.properties?.customName || template.name;
        
        // Display item description
        writeToClient(client, colorize(`You look at the ${displayName}.\r\n`, 'cyan'));
        writeToClient(client, colorize(`${template.description}\r\n`, 'cyan'));
        
        // Show additional details based on item type
        if (template.type === 'weapon') {
          writeToClient(client, colorize(`It's a weapon with ${template.stats?.attack || 0} attack power.\r\n`, 'cyan'));
        } else if (template.type === 'armor') {
          writeToClient(client, colorize(`It's armor with ${template.stats?.defense || 0} defense.\r\n`, 'cyan'));
        }
        
        // If item has requirements, show them
        if (template.requirements) {
          let reqText = 'Requirements: ';
          const reqs = [];
          if (template.requirements.level) reqs.push(`level ${template.requirements.level}`);
          if (template.requirements.strength) reqs.push(`strength ${template.requirements.strength}`);
          if (template.requirements.dexterity) reqs.push(`dexterity ${template.requirements.dexterity}`);
          
          if (reqs.length > 0) {
            writeToClient(client, colorize(reqText + reqs.join(', ') + '.\r\n', 'yellow'));
          }
        }
        
        // If the item has a history, show it
        if (instance && instance.history && instance.history.length > 0) {
          const recentHistory = instance.history[instance.history.length - 1];
          writeToClient(client, colorize(`This item was most recently ${recentHistory.event}${recentHistory.details ? ': ' + recentHistory.details : ''}.\r\n`, 'yellow'));
        }
        
        // Notify other players in the room
        this.notifyPlayersInRoom(
          roomId,
          `${formatUsername(client.user.username)} examines the ${displayName} closely.\r\n`,
          client.user.username
        );
        
        return true;
      }
    }

    // Then check legacy items in the room
    const objectMatch = room.items.find((item: Item | string) => {
      const itemName = typeof item === 'string' ? item : item.name;
      return itemName.toLowerCase() === normalizedName || 
             itemName.toLowerCase().includes(normalizedName);
    });

    if (objectMatch) {
      // Display object description
      const itemName = typeof objectMatch === 'string' ? objectMatch : objectMatch.name;
      writeToClient(client, colorize(`You look at the ${itemName}.\r\n`, 'cyan'));
      // Here we can add more detailed description based on the object type
      writeToClient(client, colorize(`It's a ${itemName} lying on the ground.\r\n`, 'cyan'));
      
      // Notify other players in the room
      this.notifyPlayersInRoom(
        roomId,
        `${formatUsername(client.user.username)} examines the ${itemName} closely.\r\n`,
        client.user.username
      );
      
      return true;
    }

    // Check for currency in the room
    if ((normalizedName === 'gold' || normalizedName.includes('gold')) && room.currency.gold > 0) {
      writeToClient(client, colorize(`You look at the gold pieces.\r\n`, 'cyan'));
      writeToClient(client, colorize(`There are ${room.currency.gold} gold pieces on the ground.\r\n`, 'cyan'));
      
      // Notify other players in the room
      this.notifyPlayersInRoom(
        roomId,
        `${formatUsername(client.user.username)} looks at the gold pieces with interest.\r\n`,
        client.user.username
      );
      
      return true;
    } else if ((normalizedName === 'silver' || normalizedName.includes('silver')) && room.currency.silver > 0) {
      writeToClient(client, colorize(`You look at the silver pieces.\r\n`, 'cyan'));
      writeToClient(client, colorize(`There are ${room.currency.silver} silver pieces on the ground.\r\n`, 'cyan'));
      
      // Notify other players in the room
      this.notifyPlayersInRoom(
        roomId,
        `${formatUsername(client.user.username)} looks at the silver pieces with interest.\r\n`,
        client.user.username
      );
      
      return true;
    } else if ((normalizedName === 'copper' || normalizedName.includes('copper')) && room.currency.copper > 0) {
      writeToClient(client, colorize(`You look at the copper pieces.\r\n`, 'cyan'));
      writeToClient(client, colorize(`There are ${room.currency.copper} copper pieces on the ground.\r\n`, 'cyan'));
      
      // Notify other players in the room
      this.notifyPlayersInRoom(
        roomId,
        `${formatUsername(client.user.username)} looks at the copper pieces with interest.\r\n`,
        client.user.username
      );
      
      return true;
    }

    // Check if it's a player in the room
    const playerMatch = room.players.find(player => 
      player.toLowerCase() === normalizedName || 
      player.toLowerCase().includes(normalizedName)
    );

    if (playerMatch) {
      // Don't let players look at themselves
      if (playerMatch.toLowerCase() === client.user.username.toLowerCase()) {
        writeToClient(client, colorize(`You look at yourself. You look... like yourself.\r\n`, 'cyan'));
            
        // Notify other players that this player is looking at themselves
        this.notifyPlayersInRoom(
          roomId,
          `${formatUsername(client.user.username)} looks over themselves.\r\n`,
          client.user.username
        );
        
        return true;
      }
      
      // Display player description
      writeToClient(client, colorize(`You look at ${formatUsername(playerMatch)}.\r\n`, 'cyan'));
      writeToClient(client, colorize(`They are another player in the game.\r\n`, 'cyan'));
      
      // Notify the player being looked at
      const targetClient = this.findClientByUsername(playerMatch);
      if (targetClient) {
        writeFormattedMessageToClient(
          targetClient, 
          colorize(`${formatUsername(client.user.username)} looks you up and down.\r\n`, 'cyan')
        );
      }
      
      // Notify other players in the room (excluding both the looker and the target)
      for (const otherPlayerName of room.players) {
        if (otherPlayerName.toLowerCase() === client.user.username.toLowerCase() || 
            otherPlayerName.toLowerCase() === playerMatch.toLowerCase()) {
          continue;
        }

        const otherClient = this.findClientByUsername(otherPlayerName);
        if (otherClient) {
          writeFormattedMessageToClient(
            otherClient, 
            colorize(`${formatUsername(client.user.username)} looks ${formatUsername(playerMatch)} up and down.\r\n`, 'cyan')
          );
        }
      }
      
      return true;
    }

    // If nothing was found in the room, check the player's inventory items (now using item instances)
    if (client.user.inventory && client.user.inventory.items) {
      // Try to find an item by instance ID
      const matchingInventoryItemId = client.user.inventory.items.find(instanceId => 
        instanceId === entityName || instanceId.includes(entityName)
      );
      
      if (matchingInventoryItemId) {
        const instance = itemManager.getItemInstance(matchingInventoryItemId);
        if (instance) {
          const template = itemManager.getItem(instance.templateId);
          if (template) {
            // Display inventory item description
            writeToClient(client, colorize(`You look at the ${template.name} in your inventory.\r\n`, 'cyan'));
            writeToClient(client, colorize(`${template.description}\r\n`, 'cyan'));
            
            // Show additional details based on item type
            if (template.type === 'weapon') {
              writeToClient(client, colorize(`It's a weapon with ${template.stats?.attack || 0} attack power.\r\n`, 'cyan'));
            } else if (template.type === 'armor') {
              writeToClient(client, colorize(`It's armor with ${template.stats?.defense || 0} defense.\r\n`, 'cyan'));
            }
            
            // Show item history if available
            if (instance.history && instance.history.length > 0) {
              writeToClient(client, colorize(`This item has a history:\r\n`, 'cyan'));
              // Only show the first and most recent history entries
              const firstEvent = instance.history[0];
              const lastEvent = instance.history[instance.history.length - 1];
              
              writeToClient(client, colorize(`- ${new Date(firstEvent.timestamp).toLocaleString()}: ${firstEvent.event} ${firstEvent.details || ''}\r\n`, 'cyan'));
              
              if (instance.history.length > 1) {
                writeToClient(client, colorize(`- ${new Date(lastEvent.timestamp).toLocaleString()}: ${lastEvent.event} ${lastEvent.details || ''}\r\n`, 'cyan'));
              }
            }
            
            // Notify other players in the room
            this.notifyPlayersInRoom(
              roomId,
              `${formatUsername(client.user.username)} examines ${template.name} from their inventory.\r\n`,
              client.user.username
            );
            
            return true;
          }
        }
      }
      
      // If instance ID wasn't found, try to find by name
      for (const instanceId of client.user.inventory.items) {
        const instance = itemManager.getItemInstance(instanceId);
        if (instance) {
          const template = itemManager.getItem(instance.templateId);
          if (template && 
              (template.name.toLowerCase() === normalizedName || 
               template.name.toLowerCase().includes(normalizedName))) {
            
            // Display inventory item description
            writeToClient(client, colorize(`You look at the ${template.name} in your inventory.\r\n`, 'cyan'));
            writeToClient(client, colorize(`${template.description}\r\n`, 'cyan'));
            
            // Show additional details based on item type
            if (template.type === 'weapon') {
              writeToClient(client, colorize(`It's a weapon with ${template.stats?.attack || 0} attack power.\r\n`, 'cyan'));
            } else if (template.type === 'armor') {
              writeToClient(client, colorize(`It's armor with ${template.stats?.defense || 0} defense.\r\n`, 'cyan'));
            }
            
            // Notify other players in the room
            this.notifyPlayersInRoom(
              roomId,
              `${formatUsername(client.user.username)} examines ${template.name} from their inventory.\r\n`,
              client.user.username
            );
            
            return true;
          }
        }
      }

      // Check for currency in inventory
      const currency = client.user.inventory.currency;
      if ((normalizedName === 'gold' || normalizedName.includes('gold')) && currency.gold > 0) {
        writeToClient(client, colorize(`You look at your gold pieces.\r\n`, 'cyan'));
        writeToClient(client, colorize(`You have ${currency.gold} gold pieces in your pouch.\r\n`, 'cyan'));
        
        // Notify other players in the room
        this.notifyPlayersInRoom(
          roomId,
          `${formatUsername(client.user.username)} counts their gold pieces.\r\n`,
          client.user.username
        );
        
        return true;
      } else if ((normalizedName === 'silver' || normalizedName.includes('silver')) && currency.silver > 0) {
        writeToClient(client, colorize(`You look at your silver pieces.\r\n`, 'cyan'));
        writeToClient(client, colorize(`You have ${currency.silver} silver pieces in your pouch.\r\n`, 'cyan'));
        
        // Notify other players in the room
        this.notifyPlayersInRoom(
          roomId,
          `${formatUsername(client.user.username)} counts their silver pieces.\r\n`,
          client.user.username
        );
        
        return true;
      } else if ((normalizedName === 'copper' || normalizedName.includes('copper')) && currency.copper > 0) {
        writeToClient(client, colorize(`You look at your copper pieces.\r\n`, 'cyan'));
        writeToClient(client, colorize(`You have ${currency.copper} copper pieces in your pouch.\r\n`, 'cyan'));
        
        // Notify other players in the room
        this.notifyPlayersInRoom(
          roomId,
          `${formatUsername(client.user.username)} counts their copper pieces.\r\n`,
          client.user.username
        );
        
        return true;
      }
    }

    // If we got here, no matching entity was found
    writeToClient(client, colorize(`You don't see anything like that here.\r\n`, 'yellow'));
    return false;
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
    if (currentRoomId && this.getRoom(currentRoomId)) {
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

    const startingRoomId = this.getStartingRoomId();
    const startingRoom = this.getRoom(startingRoomId);

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

  /**
   * Force saving rooms data
   * Public method for tick system to call
   */
  public forceSave(): void {
    this.saveRooms();
  }

  /**
   * Initialize NPCs in rooms
   */
  private initializeNPCs(): void {
    // Load NPC data from JSON
    const npcData = NPC.loadNPCData();
    
    // Add some initial NPCs to the starting room for testing
    const startingRoom = this.getRoom('start');
    if (startingRoom) {
      // Clear existing NPCs first - now using Map instead of array
      startingRoom.npcs.clear();
      
      // Add 2 cats to the starting room
      for (let i = 0; i < 2; i++) {
        // Check if cat is defined in our NPC data
        if (npcData.has('cat')) {
          const npcTemplate = npcData.get('cat')!;
          const npc = NPC.fromNPCData(npcTemplate);
          startingRoom.addNPC(npc);
        } else {
          systemLogger.warn('Cat NPC not found in data, using default values');
          const catNPC = new NPC('cat', 10, 10, [1, 3], false, false, 75);
          startingRoom.addNPC(catNPC);
        }
      }
      
      // Add a dog to the room
      if (npcData.has('dog')) {
        const npcTemplate = npcData.get('dog')!;
        const npc = NPC.fromNPCData(npcTemplate);
        startingRoom.addNPC(npc);
      }
      
      this.updateRoom(startingRoom);
    }
  }

  /**
   * Get an NPC from the room by instance ID or template ID
   */
  public getNPCFromRoom(roomId: string, npcId: string): NPC | null {
    const room = this.getRoom(roomId);
    if (!room) return null;

    // First, try to find the NPC by instanceId
    const npcByInstanceId = room.getNPC(npcId);
    if (npcByInstanceId) {
        return npcByInstanceId;
    }
    
    // If not found by instance ID, try to find by template ID (for backward compatibility)
    const matchingNPCs = room.findNPCsByTemplateId(npcId);
    if (matchingNPCs.length > 0) {
        return matchingNPCs[0]; // Return the first matching NPC
    }

    return null;
  }

  /**
   * Remove an NPC from a room by instance ID
   */
  public removeNPCFromRoom(roomId: string, npcInstanceId: string): boolean {
    const room = this.getRoom(roomId);
    if (!room) return false;

    // Check if the NPC exists in the room
    if (room.getNPC(npcInstanceId)) {
        room.removeNPC(npcInstanceId);
        this.updateRoom(room);
        return true;
    }
    
    return false;
  }

  /**
   * Store an NPC instance in the manager
   */
  public storeNPC(npcId: string, npc: NPC): void {
    this.npcs.set(npcId, npc);
  }

  /**
   * Get all rooms in the game
   * Used by the combat system to scan for hostile NPCs
   */
  public getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }
}
