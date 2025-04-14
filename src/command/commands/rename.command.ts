import { Command } from "../command.interface";
import { ConnectedClient } from "../../types";
import { colorize } from "../../utils/colors";
import { ItemManager } from "../../utils/itemManager";
import { writeToClient } from "../../utils/socketWriter";
import { colorizeItemName } from '../../utils/itemNameColorizer';
import { createContextLogger } from '../../utils/logger';

// Create a context-specific logger
const renameLogger = createContextLogger('RenameCommand');

export class RenameCommand implements Command {
  name = "rename";
  description = "Give a custom name to an item";
  private itemManager: ItemManager;

  constructor() {
    this.itemManager = ItemManager.getInstance();
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) {
      writeToClient(client, colorize("You must be logged in to use this command.\r\n", "red"));
      renameLogger.warn('Attempted to rename an item without being logged in');
      return;
    }

    renameLogger.info(`${client.user.username} is attempting to rename an item with args: "${args}"`);

    if (!args) {
      writeToClient(client, colorize("You need to specify an item and a new name. Usage: rename <item> <new name>\r\n", "yellow"));
      renameLogger.info(`${client.user.username} attempted to rename without providing arguments`);
      return;
    }

    // Get the inventory
    const inventory = client.user.inventory;
    if (!inventory || !inventory.items || inventory.items.length === 0) {
      writeToClient(client, colorize("You don't have any items to rename.\r\n", "yellow"));
      renameLogger.info(`${client.user.username} attempted to rename but has no items in inventory`);
      return;
    }

    // Split args into item name and new name
    const argParts = args.split(" ");
    if (argParts.length < 2) {
      writeToClient(client, colorize("You need to specify both an item and a new name. Usage: rename <item> <new name>\r\n", "yellow"));
      renameLogger.info(`${client.user.username} attempted to rename without providing both item name and new name`);
      return;
    }

    // First argument is the item, the rest is the new name
    const targetItemText = argParts[0];
    const newName = argParts.slice(1).join(" ");

    // Validate new name
    if (newName.length < 3) {
      writeToClient(client, colorize("The new name must be at least 3 characters long.\r\n", "red"));
      renameLogger.info(`${client.user.username} attempted to rename with a name that's too short: "${newName}"`);
      return;
    }

    if (newName.length > 30) {
      writeToClient(client, colorize("The new name must be at most 30 characters long.\r\n", "red"));
      renameLogger.info(`${client.user.username} attempted to rename with a name that's too long: "${newName}"`);
      return;
    }

    // Disallow certain special characters that might cause issues
    const forbiddenChars = /[<>\\]/;
    if (forbiddenChars.test(newName)) {
      writeToClient(client, colorize("The new name contains forbidden characters. Please avoid using < > \\\r\n", "red"));
      renameLogger.info(`${client.user.username} attempted to rename with forbidden characters: "${newName}"`);
      return;
    }

    this.processRename(client, targetItemText, newName);
  }

  private processRename(client: ConnectedClient, itemName: string, newName: string): void {
    if (!client.user) {
      writeToClient(client, colorize("You must be logged in to use this command.\r\n", "red"));
      renameLogger.warn('Attempted to process rename without being logged in');
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
      renameLogger.info(`${client.user.username} attempted to rename item "${itemName}" but it wasn't found in inventory`);
      return;
    }

    // Found the item, now rename it
    const instance = this.itemManager.getItemInstance(foundItemId);
    
    if (!instance || !instance.properties) {
      writeToClient(client, colorize("Error: Item instance or properties not found.\r\n", "red"));
      renameLogger.error(`${client.user.username} attempted to rename item "${itemName}" but instance or properties not found`);
      return;
    }

    // Get the original name for logging
    const previousName = instance.properties.customName || this.itemManager.getItem(instance.templateId)?.name || "unknown";
    
    // Store the raw name with color codes
    instance.properties.customName = newName;

    // Display the colorized version to the user
    const colorizedName = colorizeItemName(newName);
    writeToClient(client, colorize(`You've renamed the item to ${colorizedName}.\r\n`, 'green'));

    // Save the changes
    this.itemManager.saveItemInstances();
    
    // Add to item history
    this.itemManager.addItemHistory(
      foundItemId, 
      'rename', 
      `Renamed to "${newName}" by ${client.user.username}`
    );
    
    // Get the template name for the response
    const template = this.itemManager.getItem(instance.templateId);
    const originalName = template ? template.name : "item";
    
    writeToClient(client, colorize(`You rename your ${originalName} to ${colorizedName}.\r\n`, "green"));
    
    // Log the successful rename
    renameLogger.info(`${client.user.username} renamed item (ID: ${foundItemId}) from "${previousName}" to "${newName}"`);
  }

  private colorizeItemName(name: string): string {
    return colorizeItemName(name);
  }
}