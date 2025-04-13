// filepath: /Users/jelden/projects/game/src/command/commands/resetname.command.ts
import { Command } from "../command.interface";
import { ConnectedClient } from "../../types";
import { colorize } from "../../utils/colors";
import { ItemManager } from "../../utils/itemManager";
import { writeToClient } from "../../utils/socketWriter";
import { colorizeItemName } from '../../utils/itemNameColorizer';
import { createContextLogger } from '../../utils/logger';

// Create a context-specific logger
const resetNameLogger = createContextLogger('ResetNameCommand');

export class ResetNameCommand implements Command {
  name = "resetname";
  description = "Remove a custom name from an item and restore its original name";
  private itemManager: ItemManager;

  constructor() {
    this.itemManager = ItemManager.getInstance();
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) {
      writeToClient(client, colorize("You must be logged in to use this command.\r\n", "red"));
      resetNameLogger.warn('Attempted to reset item name without being logged in');
      return;
    }

    resetNameLogger.info(`${client.user.username} is attempting to reset name for item: "${args}"`);

    if (!args) {
      writeToClient(client, colorize("You need to specify which item to reset. Usage: resetname <item>\r\n", "yellow"));
      resetNameLogger.info(`${client.user.username} attempted to reset name without providing item name`);
      return;
    }

    // Get the inventory
    const inventory = client.user.inventory;
    if (!inventory || !inventory.items || inventory.items.length === 0) {
      writeToClient(client, colorize("You don't have any items to reset names for.\r\n", "yellow"));
      resetNameLogger.info(`${client.user.username} attempted to reset name but has no items in inventory`);
      return;
    }

    // First argument is the item name
    const targetItemText = args.trim();

    this.processResetName(client, targetItemText);
  }

  private processResetName(client: ConnectedClient, itemName: string): void {
    if (!client.user) {
      writeToClient(client, colorize("You must be logged in to use this command.\r\n", "red"));
      resetNameLogger.warn('Attempted to process reset name without being logged in');
      return;
    }

    // Get the inventory
    const inventory = client.user.inventory;
    let foundItem = false;
    let foundItemId = '';
    
    // Manually search for item in inventory to better handle color codes
    for (const itemId of inventory.items) {
      const displayName = this.itemManager.getItemDisplayName(itemId).toLowerCase();
      // Strip out any color codes before comparing
      const cleanDisplayName = displayName.replace(/\$[a-zA-Z0-9]/g, '');
      
      if (cleanDisplayName.includes(itemName.toLowerCase())) {
        foundItem = true;
        foundItemId = itemId;
        break;
      }
    }
    
    if (!foundItem || !foundItemId) {
      writeToClient(client, colorize(`You don't have an item called "${itemName}" in your inventory.\r\n`, "yellow"));
      resetNameLogger.info(`${client.user.username} attempted to reset name for item "${itemName}" but it wasn't found in inventory`);
      return;
    }

    // Found the item, now attempt to reset its name
    const instance = this.itemManager.getItemInstance(foundItemId);
    
    if (!instance || !instance.properties) {
      writeToClient(client, colorize("Error: Item instance or properties not found.\r\n", "red"));
      resetNameLogger.error(`${client.user.username} attempted to reset name for item "${itemName}" but instance or properties not found`);
      return;
    }

    // Check if item has a custom name
    if (!instance.properties.customName) {
      writeToClient(client, colorize("This item doesn't have a custom name to reset.\r\n", "yellow"));
      resetNameLogger.info(`${client.user.username} attempted to reset name for item "${itemName}" but it doesn't have a custom name`);
      return;
    }

    // Get the template for original name information
    const template = this.itemManager.getItem(instance.templateId);
    if (!template) {
      writeToClient(client, colorize("Error: Item template not found.\r\n", "red"));
      resetNameLogger.error(`${client.user.username} attempted to reset name for item "${itemName}" but template not found`);
      return;
    }

    // Store the previous custom name for the message
    const previousName = instance.properties.customName;

    // Use the removeCustomName method
    const success = this.itemManager.removeCustomName(foundItemId, client.user.username);
    
    if (success) {
      writeToClient(
        client, 
        colorize(`You remove the custom name "${previousName}" from your item, restoring its original name "${template.name}".\r\n`, "green")
      );
      resetNameLogger.info(`${client.user.username} reset item name (ID: ${foundItemId}) from "${previousName}" to original name "${template.name}"`);
    } else {
      writeToClient(client, colorize("Failed to reset the item's name.\r\n", "red"));
      resetNameLogger.error(`${client.user.username} failed to reset name for item "${itemName}" (ID: ${foundItemId})`);
    }
  }
}