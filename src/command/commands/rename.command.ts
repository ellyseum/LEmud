import { Command } from "../command.interface";
import { ConnectedClient } from "../../types";
import { colorize } from "../../utils/colors";
import { ItemManager } from "../../utils/itemManager";
import { writeToClient } from "../../utils/socketWriter";
import { colorizeItemName } from '../../utils/itemNameColorizer';

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
      return;
    }

    if (!args) {
      writeToClient(client, colorize("You need to specify an item and a new name. Usage: rename <item> <new name>\r\n", "yellow"));
      return;
    }

    // Get the inventory
    const inventory = client.user.inventory;
    if (!inventory || !inventory.items || inventory.items.length === 0) {
      writeToClient(client, colorize("You don't have any items to rename.\r\n", "yellow"));
      return;
    }

    // Split args into item name and new name
    const argParts = args.split(" ");
    if (argParts.length < 2) {
      writeToClient(client, colorize("You need to specify both an item and a new name. Usage: rename <item> <new name>\r\n", "yellow"));
      return;
    }

    // First argument is the item, the rest is the new name
    const targetItemText = argParts[0];
    const newName = argParts.slice(1).join(" ");

    // Validate new name
    if (newName.length < 3) {
      writeToClient(client, colorize("The new name must be at least 3 characters long.\r\n", "red"));
      return;
    }

    if (newName.length > 30) {
      writeToClient(client, colorize("The new name must be at most 30 characters long.\r\n", "red"));
      return;
    }

    // Disallow certain special characters that might cause issues
    const forbiddenChars = /[<>\\]/;
    if (forbiddenChars.test(newName)) {
      writeToClient(client, colorize("The new name contains forbidden characters. Please avoid using < > \\\r\n", "red"));
      return;
    }

    this.processRename(client, targetItemText, newName);
  }

  private processRename(client: ConnectedClient, itemName: string, newName: string): void {
    if (!client.user) {
      writeToClient(client, colorize("You must be logged in to use this command.\r\n", "red"));
      return;
    }

    // Get the inventory
    const inventory = client.user.inventory;
    let foundItem = false;
    
    // Find item in inventory
    for (let i = 0; i < inventory.items.length; i++) {
      const itemId = inventory.items[i];
      const displayName = this.itemManager.getItemDisplayName(itemId).toLowerCase();
      
      if (displayName.includes(itemName.toLowerCase())) {
        foundItem = true;
        const instance = this.itemManager.getItemInstance(itemId);
        
        if (!instance || !instance.properties) {
          writeToClient(client, colorize("Error: Item instance or properties not found.\r\n", "red"));
          return;
        }

        // Store the raw name with color codes
        instance.properties.customName = newName;

        // Display the colorized version to the user
        const colorizedName = colorizeItemName(newName);
        writeToClient(client, colorize(`You've renamed the item to ${colorizedName}.\r\n`, 'green'));

        // Save the changes
        this.itemManager.saveItemInstances();
        
        // Add to item history
        this.itemManager.addItemHistory(
          itemId, 
          'rename', 
          `Renamed to "${newName}" by ${client.user.username}`
        );
        
        // Get the template name for the response
        const template = this.itemManager.getItem(instance.templateId);
        const originalName = template ? template.name : "item";
        
        writeToClient(client, colorize(`You rename your ${originalName} to "${newName}".\r\n`, "green"));
        return;
      }
    }

    if (!foundItem) {
      writeToClient(client, colorize(`You don't have an item called "${itemName}" in your inventory.\r\n`, "yellow"));
      return;
    }
  }

  private colorizeItemName(name: string): string {
    return colorizeItemName(name);
  }
}