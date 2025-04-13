import { Command } from '../command.interface';
import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { UserManager } from '../../user/userManager';
import { ItemManager } from '../../utils/itemManager';
import { formatUsername } from '../../utils/formatters';
import { RoomManager } from '../../room/roomManager';
import { stripColorCodes, colorizeItemName } from '../../utils/itemNameColorizer';

export class DestroyCommand implements Command {
  name = 'destroy';
  description = 'Permanently destroy an item in your inventory';
  private userManager: UserManager;
  private itemManager: ItemManager;

  constructor(
    private clients: Map<string, ConnectedClient>
  ) {
    this.userManager = UserManager.getInstance();
    this.itemManager = ItemManager.getInstance();
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    // Store pending destroy items in state data
    if (!client.stateData.pendingDestroy) {
      client.stateData.pendingDestroy = undefined;
    }

    if (!args) {
      writeToClient(client, colorize('Destroy what?\r\n', 'yellow'));
      return;
    }

    const argParts = args.toLowerCase().split(' ');
    
    // Handle confirmation flow
    if (argParts[0] === 'confirm') {
      this.handleConfirmation(client);
      return;
    }

    if (argParts[0] === 'cancel') {
      this.handleCancellation(client);
      return;
    }

    // Regular destroy command - use the full args string for partial matching
    const itemName = args.toLowerCase();
    
    // Find the item in the user's inventory
    const { itemId, index, displayName } = this.findItemInInventory(client, itemName);
    
    if (!itemId) {
      writeToClient(client, colorize(`You don't have a ${itemName}.\r\n`, 'yellow'));
      return;
    }

    // Check if the item is currently equipped
    if (client.user.equipment) {
      const isEquipped = Object.values(client.user.equipment).includes(itemId);
      if (isEquipped) {
        writeToClient(client, colorize(`You must unequip the ${displayName} before destroying it.\r\n`, 'yellow'));
        return;
      }
    }

    // Set pending destroy
    client.stateData.pendingDestroy = { itemId, index, displayName };
    writeToClient(client, colorize(`Are you sure you want to permanently destroy ${colorizeItemName(displayName)}`, 'red') + colorize(`? This action cannot be undone. (destroy confirm/cancel)\r\n`, 'red'));
  }

  private handleConfirmation(client: ConnectedClient): void {
    if (!client.user || !client.stateData.pendingDestroy) {
      writeToClient(client, colorize('You have nothing pending to destroy.\r\n', 'yellow'));
      return;
    }

    const { itemId, index, displayName } = client.stateData.pendingDestroy;
    
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

    const { displayName } = client.stateData.pendingDestroy;
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
      
      console.log(`[DestroyCommand] Deleted item instance ${instanceId} from itemInstances.`);
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
}