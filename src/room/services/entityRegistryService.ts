// filepath: /Users/jelden/projects/game/src/room/services/entityRegistryService.ts
import { IEntityRegistryService } from '../interfaces';
import { ConnectedClient } from '../../types';
import { Room } from '../room';
import { NPC } from '../../combat/npc';
import { colorize } from '../../utils/colors';
import { writeToClient, writeFormattedMessageToClient } from '../../utils/socketWriter';
import { formatUsername } from '../../utils/formatters';
import { systemLogger } from '../../utils/logger';

export class EntityRegistryService implements IEntityRegistryService {
  private roomManager: {
    getRoom: (roomId: string) => Room | undefined;
    getStartingRoomId: () => string;
    updateRoom: (room: Room) => void;
  };
  private clients: Map<string, ConnectedClient>;
  private npcs: Map<string, NPC> = new Map();
  private notifyPlayersInRoom: (roomId: string, message: string, excludeUsername?: string) => void;
  private teleportToStartingRoom: (client: ConnectedClient) => boolean;

  constructor(
    roomManager: {
      getRoom: (roomId: string) => Room | undefined;
      getStartingRoomId: () => string;
      updateRoom: (room: Room) => void;
    },
    clients: Map<string, ConnectedClient>,
    notifyPlayersInRoom: (roomId: string, message: string, excludeUsername?: string) => void,
    teleportToStartingRoom: (client: ConnectedClient) => boolean
  ) {
    this.roomManager = roomManager;
    this.clients = clients;
    this.notifyPlayersInRoom = notifyPlayersInRoom;
    this.teleportToStartingRoom = teleportToStartingRoom;
  }

  /**
   * Find a client by username
   */
  public findClientByUsername(username: string): ConnectedClient | undefined {
    for (const [_, client] of this.clients.entries()) {
      if (client.user && client.user.username.toLowerCase() === username.toLowerCase()) {
        return client;
      }
    }
    return undefined;
  }

  /**
   * Get an NPC from the room by instance ID or template ID
   */
  public getNPCFromRoom(roomId: string, npcId: string): NPC | null {
    const room = this.roomManager.getRoom(roomId);
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
    const room = this.roomManager.getRoom(roomId);
    if (!room) return false;

    // Check if the NPC exists in the room
    if (room.getNPC(npcInstanceId)) {
        room.removeNPC(npcInstanceId);
        this.roomManager.updateRoom(room);
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
   * Examine a specific entity (item, NPC, player) in the room or inventory
   * @param client The connected client
   * @param entityName The name of the entity to examine
   * @returns true if entity was found and examined, false otherwise
   */
  public lookAtEntity(client: ConnectedClient, entityName: string): boolean {
    if (!client.user) return false;

    // Import the ItemManager
    const { ItemManager } = require('../../utils/itemManager');
    const itemManager = ItemManager.getInstance();

    // Get current room
    const roomId = client.user.currentRoomId || this.roomManager.getStartingRoomId();
    const room = this.roomManager.getRoom(roomId);

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
    const objectMatch = room.items.find((item) => {
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
}