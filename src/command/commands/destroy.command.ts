import { Command } from '../command.interface';
import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { UserManager } from '../../user/userManager';
import { ItemManager } from '../../utils/itemManager';
import { formatUsername } from '../../utils/formatters';
import { RoomManager } from '../../room/roomManager';
import { stripColorCodes, colorizeItemName } from '../../utils/itemNameColorizer';
import { createContextLogger, getPlayerLogger } from '../../utils/logger';
import { SudoCommand } from './sudo.command';

// Create a context-specific logger for DestroyCommand
const destroyLogger = createContextLogger('DestroyCommand');

// Create a player action logger
const playerLogger = createContextLogger('Player');

export class DestroyCommand implements Command {
  name = 'destroy';
  description = 'Permanently destroy an item in your inventory';
  private userManager: UserManager;
  private itemManager: ItemManager;
  private roomManager: RoomManager;

  constructor(
    private clients: Map<string, ConnectedClient>
  ) {
    this.userManager = UserManager.getInstance();
    this.itemManager = ItemManager.getInstance();
    // Fix: Pass clients map instead of private activeUserSessions
    this.roomManager = RoomManager.getInstance(this.clients);
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    // Admin check
    const sudoCommand = SudoCommand.getInstance();
    if (!sudoCommand.isAuthorized(client.user.username)) {
      writeToClient(client, colorize('You do not have permission to use this command.\r\n', 'red'));
      writeToClient(client, colorize('Use "sudo" to gain admin privileges if authorized.\r\n', 'yellow'));
      return;
    }

    if (!args) {
      writeToClient(client, colorize('Usage: destroy <instanceId>\r\n', 'yellow'));
      return;
    }

    const instanceId = args.trim();

    // First try exact match
    let instance = this.itemManager.getItemInstance(instanceId);
    let fullInstanceId = instanceId;

    // If not found but it's at least 8 characters, try partial matching
    if (!instance && instanceId.length >= 8) {
      try {
        instance = this.itemManager.findInstanceByPartialId(instanceId);
        if (instance) {
          fullInstanceId = instance.instanceId;
        }
      } catch (err) {
        // Continue with normal flow if partial matching fails
      }
    }

    if (!instance) {
      writeToClient(client, colorize(`Item instance with ID "${instanceId}" not found.\r\n`, 'red'));
      return;
    }

    // Get the template for display purposes
    const template = this.itemManager.getItem(instance.templateId);
    if (!template) {
      writeToClient(client, colorize(`Template for item instance "${fullInstanceId}" not found.\r\n`, 'red'));
      return;
    }

    // Find and remove the item from all possible locations
    const { location, owner } = this.findAndRemoveItem(fullInstanceId);

    // Delete the instance
    const success = this.itemManager.deleteItemInstance(fullInstanceId);

    if (success) {
      // Log the player action
      const itemName = instance.properties?.customName || template.name;
      if (location && owner) {
        playerLogger.info(`${client.user.username} destroyed ${itemName} (instance: ${fullInstanceId}) from ${owner}'s ${location}`);
      } else if (location) {
        playerLogger.info(`${client.user.username} destroyed ${itemName} (instance: ${fullInstanceId}) from ${location}`);
      } else {
        playerLogger.info(`${client.user.username} destroyed ${itemName} (instance: ${fullInstanceId})`);
      }

      // Notify the admin
      if (location && owner) {
        writeToClient(client, colorize(`Destroyed ${itemName} (instance: ${fullInstanceId}) from ${owner}'s ${location}.\r\n`, 'green'));
      } else if (location) {
        writeToClient(client, colorize(`Destroyed ${itemName} (instance: ${fullInstanceId}) from ${location}.\r\n`, 'green'));
      } else {
        writeToClient(client, colorize(`Destroyed ${itemName} (instance: ${fullInstanceId}).\r\n`, 'green'));
      }

      // Notify the previous owner if they're online and not the admin
      if (owner && owner !== client.user.username) {
        const ownerClient = this.userManager.getActiveUserSession(owner);
        if (ownerClient) {
          writeToClient(ownerClient, colorize(`An admin has destroyed ${itemName} from your possession.\r\n`, 'yellow'));
        }
      }
    } else {
      writeToClient(client, colorize(`Failed to destroy item instance "${fullInstanceId}".\r\n`, 'red'));
    }
  }

  private handleConfirmation(client: ConnectedClient): void {
    if (!client.user || !client.stateData.pendingDestroy) {
      writeToClient(client, colorize('You have nothing pending to destroy.\r\n', 'yellow'));
      return;
    }

    const { itemId, index, displayName } = client.stateData.pendingDestroy;
    
    // Get player logger for this user
    const playerLogger = getPlayerLogger(client.user.username);
    
    // Log item destruction
    playerLogger.info(`Destroyed item: ${stripColorCodes(displayName)} (ID: ${itemId})`);
    
    // Remove the item from inventory
    client.user.inventory.items.splice(index, 1);
    
    // Save user changes
    this.userManager.updateUserInventory(client.user.username, client.user.inventory);
    
    // If this is an item instance, add destroy event to its history
    const instance = this.itemManager.getItemInstance(itemId);
    if (instance) {
      // Add the destroy event to history
      this.itemManager.addItemHistory(
        itemId,
        'destroy',
        `Destroyed by ${client.user.username}`
      );
      
      // Get item template info for better logging
      const template = this.itemManager.getItem(instance.templateId);
      if (template) {
        playerLogger.info(`Item details - Template: ${template.name}, Type: ${template.type || 'unknown'}, Stats: ${JSON.stringify(template.stats || {})}`);
      }
      
      // Delete the item instance from the item instances table
      this.itemManager.deleteItemInstance(itemId);
    }
    
    writeToClient(client, colorize(`You destroy the ${colorizeItemName(displayName)}.\r\n`, 'green'));
    
    // Clear pending destroy
    client.stateData.pendingDestroy = undefined;
  }

  private handleCancellation(client: ConnectedClient): void {
    if (!client.stateData.pendingDestroy) {
      writeToClient(client, colorize('You have nothing pending to destroy.\r\n', 'yellow'));
      return;
    }

    const { displayName, itemId } = client.stateData.pendingDestroy;
    
    // Get player logger for this user
    if (client.user) {
      const playerLogger = getPlayerLogger(client.user.username);
      playerLogger.info(`Cancelled destruction of item: ${stripColorCodes(displayName)} (ID: ${itemId})`);
    }
    
    writeToClient(client, colorize(`You decide not to destroy the ${colorizeItemName(displayName)}.\r\n`, 'green'));
    
    // Clear pending destroy
    client.stateData.pendingDestroy = undefined;
  }

  /**
   * Delete an item instance from the itemInstances map
   */
  private deleteItemInstance(instanceId: string): void {
    // Get the Map of itemInstances from the ItemManager
    const itemInstances = (this.itemManager as any).itemInstances;
    
    // Check if it exists and delete it
    if (itemInstances && itemInstances.has(instanceId)) {
      itemInstances.delete(instanceId);
      
      // Save the changes to disk
      this.itemManager.saveItemInstances();
      
      destroyLogger.info(`Deleted item instance ${instanceId} from itemInstances.`);
    }
  }

  /**
   * Find an item in the user's inventory by name
   */
  private findItemInInventory(client: ConnectedClient, itemName: string): { itemId: string | undefined, index: number, displayName: string } {
    if (!client.user || !client.user.inventory || !client.user.inventory.items || client.user.inventory.items.length === 0) {
      return { itemId: undefined, index: -1, displayName: '' };
    }
    
    // Normalize the input by stripping color codes and converting to lowercase
    const normalizedInput = stripColorCodes(itemName.toLowerCase());
    
    // Try to find by exact instance ID first
    let itemIndex = client.user.inventory.items.findIndex(id => id === itemName);
    
    // If not found by exact ID, try case-insensitive ID match
    if (itemIndex === -1) {
      itemIndex = client.user.inventory.items.findIndex(id => id.toLowerCase() === normalizedInput);
    }
    
    // If still not found, try to find by custom name (exact match)
    if (itemIndex === -1) {
      itemIndex = client.user.inventory.items.findIndex(instanceId => {
        const instance = this.itemManager.getItemInstance(instanceId);
        if (instance && instance.properties && instance.properties.customName) {
          const strippedCustomName = stripColorCodes(instance.properties.customName.toLowerCase());
          return strippedCustomName === normalizedInput;
        }
        return false;
      });
    }
    
    // If still not found, try to find by template name
    if (itemIndex === -1) {
      itemIndex = client.user.inventory.items.findIndex(instanceId => {
        // Check if it's an item instance
        const instance = this.itemManager.getItemInstance(instanceId);
        if (instance) {
          const template = this.itemManager.getItem(instance.templateId);
          if (template) {
            const strippedTemplateName = stripColorCodes(template.name.toLowerCase());
            return strippedTemplateName === normalizedInput;
          }
        }
        
        // Check if it's a legacy item
        const item = this.itemManager.getItem(instanceId);
        if (item) {
          const strippedItemName = stripColorCodes(item.name.toLowerCase());
          return strippedItemName === normalizedInput;
        }
        
        return false;
      });
    }
    
    // Try partial custom name matching
    if (itemIndex === -1) {
      itemIndex = client.user.inventory.items.findIndex(instanceId => {
        const instance = this.itemManager.getItemInstance(instanceId);
        if (instance && instance.properties && instance.properties.customName) {
          const strippedCustomName = stripColorCodes(instance.properties.customName.toLowerCase());
          return strippedCustomName.includes(normalizedInput);
        }
        return false;
      });
    }
    
    // Finally, try partial template name matching
    if (itemIndex === -1) {
      itemIndex = client.user.inventory.items.findIndex(instanceId => {
        // Check if it's an item instance
        const instance = this.itemManager.getItemInstance(instanceId);
        if (instance) {
          const template = this.itemManager.getItem(instance.templateId);
          if (template) {
            const strippedTemplateName = stripColorCodes(template.name.toLowerCase());
            return strippedTemplateName.includes(normalizedInput);
          }
        }
        
        // Check if it's a legacy item
        const item = this.itemManager.getItem(instanceId);
        if (item) {
          const strippedItemName = stripColorCodes(item.name.toLowerCase());
          return strippedItemName.includes(normalizedInput);
        }
        
        return false;
      });
    }
    
    if (itemIndex === -1) {
      return { itemId: undefined, index: -1, displayName: '' };
    }
    
    // Get the item ID from the inventory
    const itemId = client.user.inventory.items[itemIndex];
    
    // Get the item display name
    let displayName = itemId; // Default to ID if we can't get a proper name
    
    // Try to get the name from the item instance or template
    const instance = this.itemManager.getItemInstance(itemId);
    if (instance) {
      const template = this.itemManager.getItem(instance.templateId);
      if (template) {
        displayName = instance.properties?.customName || template.name;
      }
    } else {
      // Try as a legacy item
      const item = this.itemManager.getItem(itemId);
      if (item) {
        displayName = item.name;
      }
    }
    
    return { itemId, index: itemIndex, displayName };
  }

  /**
   * Find and remove an item from all possible locations (inventory, equipment, room)
   * @param instanceId The ID of the item to find and remove
   * @returns Information about where the item was found and from whom
   */
  private findAndRemoveItem(instanceId: string): { location?: string, owner?: string } {
    // Check all user inventories and equipment
    const users = this.userManager.getAllUsers();
    for (const user of users) {
      // Check inventory
      if (user.inventory?.items?.includes(instanceId)) {
        // Remove from inventory
        const index = user.inventory.items.indexOf(instanceId);
        if (index !== -1) {
          user.inventory.items.splice(index, 1);
          this.userManager.updateUserInventory(user.username, user.inventory);
          return { location: 'inventory', owner: user.username };
        }
      }

      // Check equipment slots
      if (user.equipment) {
        for (const [slot, equippedItemId] of Object.entries(user.equipment)) {
          if (equippedItemId === instanceId) {
            // Remove from equipment
            delete user.equipment[slot];
            this.userManager.updateUserStats(user.username, { equipment: user.equipment });
            return { location: `equipment (${slot})`, owner: user.username };
          }
        }
      }
    }

    // Check all rooms
    const rooms = this.roomManager.getAllRooms();
    for (const room of rooms) {
      // Check room's itemInstances Map first
      if (room.hasItemInstance(instanceId)) {
        room.removeItemInstance(instanceId);
        this.roomManager.updateRoom(room);
        return { location: `room ${room.id}` };
      }
      
      // Then check legacy items array (compare by name, not ID)
      const itemIndex = room.items.findIndex(item => {
        const itemName = typeof item === 'string' ? item : item.name;
        return itemName === instanceId;
      });
      
      if (itemIndex !== -1) {
        room.items.splice(itemIndex, 1);
        this.roomManager.updateRoom(room);
        return { location: `room ${room.id} (legacy item)` };
      }
    }

    // Item not found in any location
    destroyLogger.warn(`Item ${instanceId} not found in any inventory, equipment, or room`);
    return {};
  }
}