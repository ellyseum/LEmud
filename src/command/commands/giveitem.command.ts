// filepath: /Users/jelden/projects/game/src/command/commands/giveitem.command.ts
import { ConnectedClient, GameItem, ItemInstance } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { ItemManager } from '../../utils/itemManager';
import { UserManager } from '../../user/userManager';
import { SudoCommand } from './sudo.command';
import { RoomManager } from '../../room/roomManager';
import { colorizeItemName } from '../../utils/itemNameColorizer';
import { createContextLogger } from '../../utils/logger';

// Create a player action logger
const playerLogger = createContextLogger('Player');

export class GiveItemCommand implements Command {
  name = 'giveitem';
  description = 'Give an item to a player (Admin only)';
  private itemManager: ItemManager;
  private userManager: UserManager;
  private roomManager: RoomManager;

  constructor(userManager: UserManager) {
    this.itemManager = ItemManager.getInstance();
    this.userManager = userManager;
    // Fix: Create an empty map to pass to RoomManager
    const clients = new Map<string, ConnectedClient>();
    // Get all active users and add them to the clients map
    const allUsers = this.userManager.getAllUsers();
    for (const user of allUsers) {
      const client = this.userManager.getActiveUserSession(user.username);
      if (client && client.id) {
        clients.set(client.id, client);
      }
    }
    this.roomManager = RoomManager.getInstance(clients);
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    // Get the sudo command to check for admin privileges
    let sudoCommand: SudoCommand | undefined;
    
    // Try to get the sudo command from client's state data first
    if (client.stateData && client.stateData.commands) {
      sudoCommand = client.stateData.commands.get('sudo') as SudoCommand;
    }
    
    // If not found in state data, get the singleton instance
    if (!sudoCommand) {
      sudoCommand = SudoCommand.getInstance();
    }
    
    // Check if the user has admin privileges
    const hasAdminAccess = sudoCommand.isAuthorized(client.user.username);
    if (!hasAdminAccess) {
      writeToClient(client, colorize('You do not have permission to use this command.\r\n', 'red'));
      writeToClient(client, colorize('Hint: Use "sudo" to gain admin privileges if authorized.\r\n', 'yellow'));
      return;
    }

    const argParts = args.split(' ');
    
    // Format: giveitem <itemId> [username]
    // Format: giveitem instance <instanceId> [username]
    if (argParts.length === 0) {
      writeToClient(client, colorize('Usage: giveitem <itemId> [username]\r\n', 'yellow'));
      writeToClient(client, colorize('   or: giveitem instance <instanceId> [username]\r\n', 'yellow'));
      this.listAvailableItems(client);
      return;
    }

    // Check if we're dealing with an instance
    if (argParts[0].toLowerCase() === 'instance') {
      this.handleInstanceGiving(client, argParts.slice(1));
      return;
    }
    
    // Handle normal item template giving
    let itemId = argParts[0];
    let targetUsername = argParts.length > 1 ? argParts[1] : client.user.username;
    
    if (!itemId) {
      writeToClient(client, colorize('Usage: giveitem <itemId> [username]\r\n', 'yellow'));
      this.listAvailableItems(client);
      return;
    }

    // First check if the input looks like a UUID/instance ID (8 or more alphanumeric chars)
    // This allows users to skip the "instance" keyword for convenience
    if (itemId.length >= 8 && /^[0-9a-f]+$/i.test(itemId)) {
      // Try to find as an instance
      let instance = this.itemManager.getItemInstance(itemId);

      // If not found directly, try partial matching
      if (!instance && itemId.length >= 8) {
        try {
          instance = this.itemManager.findInstanceByPartialId(itemId);
        } catch (err) {
          // If error, continue with normal flow
        }
      }

      // If we found an instance, handle it as if "instance" keyword was used
      if (instance) {
        writeToClient(client, colorize(`Detected instance ID. Using "instance" mode.\r\n`, 'cyan'));
        this.handleInstanceGiving(client, [itemId, ...(argParts.length > 1 ? [argParts[1]] : [])]);
        return;
      }
    }

    // Get the item
    const item = this.itemManager.getItem(itemId);
    if (!item) {
      writeToClient(client, colorize(`Item with ID "${itemId}" not found.\r\n`, 'red'));
      this.listAvailableItems(client);
      return;
    }

    // Find the target user
    const targetUser = this.userManager.getUser(targetUsername);
    if (!targetUser) {
      writeToClient(client, colorize(`User "${targetUsername}" not found.\r\n`, 'red'));
      return;
    }

    // Create a new instance of the item for the user
    const instance = this.itemManager.createItemInstance(itemId, client.user.username);
    if (!instance) {
      writeToClient(client, colorize(`Failed to create an instance of item "${itemId}".\r\n`, 'red'));
      return;
    }

    const instanceId = instance.instanceId;

    // Add the item to the target user's inventory
    if (!targetUser.inventory) {
      targetUser.inventory = {
        items: [],
        currency: { gold: 0, silver: 0, copper: 0 }
      };
    }
    
    if (!targetUser.inventory.items) {
      targetUser.inventory.items = [];
    }
    
    targetUser.inventory.items.push(instanceId);
    
    // Save the changes
    this.userManager.updateUserInventory(targetUsername, targetUser.inventory);
    
    // Log the player action
    playerLogger.info(`${client.user.username} gave ${item.name} (${itemId}, instance: ${instanceId}) to ${targetUsername}`);
    
    // Notify the admin
    if (targetUsername === client.user.username) {
      writeToClient(client, colorize(`Added ${item.name} to your inventory. Instance ID: ${instanceId}\r\n`, 'green'));
    } else {
      writeToClient(client, colorize(`Added ${item.name} to ${targetUsername}'s inventory. Instance ID: ${instanceId}\r\n`, 'green'));
    }
    
    // Notify the target user if they're online and not the admin
    if (targetUsername !== client.user.username) {
      const targetClient = this.userManager.getActiveUserSession(targetUsername);
      if (targetClient) {
        writeToClient(targetClient, colorize(`${client.user.username} gave you ${item.name}.\r\n`, 'green'));
      }
    }
  }
  
  /**
   * Handle giving a specific item instance to a player
   */
  private handleInstanceGiving(client: ConnectedClient, args: string[]): void {
    if (!client.user) return;
    
    if (args.length === 0) {
      writeToClient(client, colorize('Usage: giveitem instance <instanceId> [username]\r\n', 'yellow'));
      return;
    }
    
    const inputInstanceId = args[0];
    const targetUsername = args.length > 1 ? args[1] : client.user.username;
    
    // Find the target user
    const targetUser = this.userManager.getUser(targetUsername);
    if (!targetUser) {
      writeToClient(client, colorize(`User "${targetUsername}" not found.\r\n`, 'red'));
      return;
    }
    
    // First try exact match
    let instance = this.itemManager.getItemInstance(inputInstanceId);
    let fullInstanceId = '';  // Initialize to empty string
    
    // If not found but it's at least 8 characters, try partial matching
    if (!instance && inputInstanceId.length >= 8) {
      try {
        // Try to find instance by partial ID
        instance = this.itemManager.findInstanceByPartialId(inputInstanceId);
        
        // If undefined, it means multiple items matched (ambiguous)
        if (instance === undefined) {
          writeToClient(client, colorize(`Multiple items match ID '${inputInstanceId}'. Please use a longer ID to be more specific.\r\n`, 'yellow'));
          
          // Show the matching instances for convenience
          const matchingInstances = this.findInstancesByPartialId(inputInstanceId);
          if (matchingInstances.length > 0) {
            writeToClient(client, colorize(`Matching instances:\r\n`, 'cyan'));
            matchingInstances.forEach((matchInstance, index) => {
              const template = this.itemManager.getItem(matchInstance.templateId);
              const displayName = matchInstance.properties?.customName || (template ? template.name : 'Unknown');
              writeToClient(client, colorize(`  ${index + 1}. ${displayName} (ID: ${matchInstance.instanceId})\r\n`, 'white'));
            });
          }
          return;
        }
      } catch (err) {
        // In case the findInstanceByPartialId method doesn't exist or throws
        writeToClient(client, colorize(`Error finding item by partial ID: ${err}\r\n`, 'red'));
        return;
      }
    }
    
    if (!instance) {
      writeToClient(client, colorize(`Item instance with ID "${inputInstanceId}" not found.\r\n`, 'red'));
      return;
    }
    
    // Get the full instance ID from the instance object
    fullInstanceId = instance.instanceId;
    
    // Get the template for display purposes
    const template = this.itemManager.getItem(instance.templateId);
    if (!template) {
      writeToClient(client, colorize(`Template for item instance "${fullInstanceId}" not found.\r\n`, 'red'));
      return;
    }
    
    // Find and remove the item from all possible locations
    const { location, owner } = this.findAndRemoveItem(fullInstanceId);
    
    // Add to the new user's inventory
    if (!targetUser.inventory) {
      targetUser.inventory = {
        items: [],
        currency: { gold: 0, silver: 0, copper: 0 }
      };
    }
    
    if (!targetUser.inventory.items) {
      targetUser.inventory.items = [];
    }
    
    // Add the FULL instance ID to the inventory
    targetUser.inventory.items.push(fullInstanceId);
    
    // Add transfer to item history
    this.itemManager.addItemHistory(fullInstanceId, 'admin-transfer', `Transferred from ${location} ${owner ? `(${owner})` : ''} to ${targetUsername} by admin ${client.user.username}`);
    
    // Log the player action
    const itemName = instance.properties?.customName || template.name;
    playerLogger.info(`${client.user.username} transferred ${itemName} (instance: ${fullInstanceId}) from ${location || 'unknown'} ${owner ? `(${owner})` : ''} to ${targetUsername}`);
    
    // Save the changes
    this.userManager.updateUserInventory(targetUsername, targetUser.inventory);
    
    // Notify the admin
    if (targetUsername === client.user.username) {
      writeToClient(client, colorize(`Added ${colorizeItemName(itemName)} to your inventory. Full ID: ${fullInstanceId}\r\n`, 'green'));
    } else {
      if (location && owner) {
        writeToClient(client, colorize(`Transferred ${colorizeItemName(itemName)} from ${owner}'s ${location} to ${targetUsername}. Full ID: ${fullInstanceId}\r\n`, 'green'));
      } else if (location) {
        writeToClient(client, colorize(`Transferred ${colorizeItemName(itemName)} from ${location} to ${targetUsername}. Full ID: ${fullInstanceId}\r\n`, 'green'));
      } else {
        writeToClient(client, colorize(`Transferred ${colorizeItemName(itemName)} to ${targetUsername}. Full ID: ${fullInstanceId}\r\n`, 'green'));
      }
    }
    
    // Notify the previous owner if they're online and not the admin
    if (owner && owner !== client.user.username) {
      const ownerClient = this.userManager.getActiveUserSession(owner);
      if (ownerClient) {
        writeToClient(ownerClient, colorize(`An admin has removed ${colorizeItemName(itemName)} from your possession.\r\n`, 'yellow'));
      }
    }
    
    // Notify the target user if they're online and not the admin
    if (targetUsername !== client.user.username) {
      const targetClient = this.userManager.getActiveUserSession(targetUsername);
      if (targetClient) {
        writeToClient(targetClient, colorize(`${client.user.username} gave you ${colorizeItemName(itemName)}.\r\n`, 'green'));
      }
    }
  }
  
  /**
   * Find and remove an item from all possible locations
   * Returns information about where the item was found
   */
  private findAndRemoveItem(instanceId: string): { location: string | null, owner: string | null } {
    // Check all users' inventories and equipment
    const allUsers = this.userManager.getAllUsers();
    
    for (const user of allUsers) {
      // Check inventory
      if (user.inventory && user.inventory.items && user.inventory.items.includes(instanceId)) {
        const itemIndex = user.inventory.items.indexOf(instanceId);
        if (itemIndex !== -1) {
          user.inventory.items.splice(itemIndex, 1);
          this.userManager.updateUserInventory(user.username, user.inventory);
          return { location: 'inventory', owner: user.username };
        }
      }
      
      // Check equipment
      if (user.equipment) {
        for (const slot in user.equipment) {
          if (user.equipment[slot] === instanceId) {
            const previousSlot = slot;
            // Fix: Use empty string instead of null
            user.equipment[slot] = '';
            // Fix: Use updateUserStats to update equipment since updateUser doesn't exist
            this.userManager.updateUserStats(user.username, { equipment: user.equipment });
            return { location: `equipment (${previousSlot})`, owner: user.username };
          }
        }
      }
    }
    
    // Check all rooms
    const allRooms = this.roomManager.getAllRooms();
    for (const room of allRooms) {
      const hasItem = room.hasItemInstance(instanceId);
      if (hasItem) {
        room.removeItemInstance(instanceId);
        this.roomManager.updateRoom(room);
        return { location: `room (${room.id}: ${room.name})`, owner: null };
      }
    }
    
    // If not found anywhere, return null
    return { location: null, owner: null };
  }
  
  /**
   * Helper method to find instances by partial ID
   */
  private findInstancesByPartialId(partialId: string): ItemInstance[] {
    // Get all instances from the item manager
    const allInstances = this.itemManager.getAllItemInstances();
    const matchingInstances: ItemInstance[] = [];
    
    // Filter instances that match the partial ID
    for (const instance of allInstances) {
      if (instance.instanceId.toLowerCase().startsWith(partialId.toLowerCase())) {
        matchingInstances.push(instance);
      }
    }
    
    return matchingInstances;
  }
  
  /**
   * List all available items that can be given
   */
  private listAvailableItems(client: ConnectedClient): void {
    const items = this.itemManager.getAllItems();
    
    if (items.length === 0) {
      writeToClient(client, colorize('No items available.\r\n', 'yellow'));
      return;
    }
    
    writeToClient(client, colorize('Available items:\r\n', 'cyan'));
    
    // Group items by type
    const itemsByType: { [type: string]: GameItem[] } = {};
    
    items.forEach(item => {
      if (!itemsByType[item.type]) {
        itemsByType[item.type] = [];
      }
      itemsByType[item.type].push(item);
    });
    
    // Display items grouped by type
    for (const type in itemsByType) {
      writeToClient(client, colorize(`\r\n${type.toUpperCase()}:\r\n`, 'yellow'));
      
      itemsByType[type].forEach(item => {
        writeToClient(client, colorize(`  ${item.id} - ${item.name}\r\n`, 'white'));
      });
    }
  }
}