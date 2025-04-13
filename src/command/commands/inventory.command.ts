import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { formatUsername } from '../../utils/formatters';
import { ItemManager } from '../../utils/itemManager';
import { colorizeItemName } from '../../utils/itemNameColorizer';

export class InventoryCommand implements Command {
  name = 'inventory';
  description = 'Show your inventory contents';
  aliases = ['inv', 'i'];
  private itemManager: ItemManager;
  
  constructor() {
    this.itemManager = ItemManager.getInstance();
  }

  execute(client: ConnectedClient, _args: string): void {
    if (!client.user) return;

    // Ensure inventory structure exists
    if (!client.user.inventory) {
      client.user.inventory = {
        items: [],
        currency: { gold: 0, silver: 0, copper: 0 }
      };
    }

    if (!client.user.inventory.items) {
      client.user.inventory.items = [];
    }

    if (!client.user.inventory.currency) {
      client.user.inventory.currency = { gold: 0, silver: 0, copper: 0 };
    }

    this.displayInventory(client);
  }

  /**
   * Display a formatted list of the player's inventory
   */
  private displayInventory(client: ConnectedClient): void {
    if (!client.user) return;

    const inventory = client.user.inventory;
    
    writeToClient(client, colorize(`Your Inventory:\r\n`, 'cyan'));
    writeToClient(client, colorize(`-----------------------------------------\r\n`, 'cyan'));
    
    // Display currency
    if (inventory.currency) {
      const currency = inventory.currency;
      
      if (currency.gold > 0 || currency.silver > 0 || currency.copper > 0) {
        writeToClient(client, colorize(`Currency:\r\n`, 'yellow'));
        
        if (currency.gold > 0) {
          writeToClient(client, colorize(`  ${currency.gold} gold piece${currency.gold !== 1 ? 's' : ''}\r\n`, 'yellow'));
        }
        
        if (currency.silver > 0) {
          writeToClient(client, colorize(`  ${currency.silver} silver piece${currency.silver !== 1 ? 's' : ''}\r\n`, 'white'));
        }
        
        if (currency.copper > 0) {
          writeToClient(client, colorize(`  ${currency.copper} copper piece${currency.copper !== 1 ? 's' : ''}\r\n`, 'red'));
        }
        
        writeToClient(client, colorize(`\r\n`, 'white'));
      } else {
        writeToClient(client, colorize(`Currency: None\r\n\r\n`, 'yellow'));
      }
    }
    
    // Display items
    if (inventory.items && inventory.items.length > 0) {
      writeToClient(client, colorize(`Items (${inventory.items.length}):\r\n`, 'yellow'));
      
      const itemsByType: { [key: string]: Array<{ id: string, name: string, equipped: boolean }> } = {};
      
      // Get the user's equipment for checking what's equipped
      const equipment = client.user.equipment || {};
      const equippedIds = Object.values(equipment);
      
      // Group items by type
      for (const itemId of inventory.items) {
        let item: any;
        let customName: string | undefined;
        let type = "Unknown";
        let isEquipped = equippedIds.includes(itemId);
        
        // First, check if it's an item instance
        const instance = this.itemManager.getItemInstance(itemId);
        
        if (instance) {
          // It's an instance, get the template for type/base name
          const template = this.itemManager.getItem(instance.templateId);
          if (template) {
            item = template;
            type = template.type || "Unknown";
            
            // Check for custom name
            customName = instance.properties?.customName;
          }
        } else {
          // It's a legacy item, just get it directly
          item = this.itemManager.getItem(itemId);
          if (item) {
            type = item.type || "Unknown";
          }
        }
        
        if (!item) {
          // Unknown item, skip or add to special category
          if (!itemsByType["Unknown"]) {
            itemsByType["Unknown"] = [];
          }
          itemsByType["Unknown"].push({ 
            id: itemId, 
            name: `Unknown Item (${itemId})`,
            equipped: isEquipped
          });
          continue;
        }
        
        // Initialize array for this type if needed
        if (!itemsByType[type]) {
          itemsByType[type] = [];
        }
        
        // Add to appropriate type group
        let displayName = item.name;
        
        // If item has a custom name, colorize it
        if (customName) {
          displayName = colorizeItemName(customName);
        }
        
        itemsByType[type].push({ 
          id: itemId, 
          name: displayName,
          equipped: isEquipped
        });
      }
      
      // Display items by type
      const sortedTypes = Object.keys(itemsByType).sort();
      
      for (const type of sortedTypes) {
        writeToClient(client, colorize(`\r\n  ${type}:\r\n`, 'green'));
        
        // Sort items by name within the type
        const items = itemsByType[type].sort((a, b) => {
          // First by equipped status (equipped first)
          if (a.equipped && !b.equipped) return -1;
          if (!a.equipped && b.equipped) return 1;
          
          // Then by name
          return a.name.localeCompare(b.name);
        });
        
        for (const item of items) {
          const equipped = item.equipped ? ' (equipped)' : '';
          writeToClient(client, colorize(`    - ${item.name}${equipped}\r\n`, 'white'));
        }
      }
    } else {
      writeToClient(client, colorize(`Items: None\r\n`, 'yellow'));
    }
    
    writeToClient(client, colorize(`-----------------------------------------\r\n`, 'cyan'));
  }
}
