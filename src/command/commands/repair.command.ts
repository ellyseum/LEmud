// filepath: /Users/jelden/projects/game/src/command/commands/repair.command.ts
import { Command } from "../command.interface";
import { ConnectedClient } from "../../types";
import { colorize } from "../../utils/colors";
import { ItemManager } from "../../utils/itemManager";
import { writeToClient } from "../../utils/socketWriter";

export class RepairCommand implements Command {
  name = "repair";
  description = "Repair a damaged item";
  
  private itemManager: ItemManager;
  
  constructor() {
    this.itemManager = ItemManager.getInstance();
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) {
      writeToClient(client, colorize("You must be logged in to use this command.\r\n", "red"));
      return;
    }

    const argArray = args.trim().split(/\s+/);
    
    if (argArray.length === 0 || args.trim() === '') {
      writeToClient(client, colorize("Which item would you like to repair?\r\n", "yellow"));
      return;
    }

    const itemName = args.trim();
    
    // Ensure inventory structure exists
    if (!client.user.inventory) {
      client.user.inventory = { items: [], currency: { gold: 0, silver: 0, copper: 0 } };
    }
    
    // First check if player tried to repair all items
    if (itemName.toLowerCase() === "all") {
      // Repair all damaged items in inventory
      let itemsFound = 0;
      let itemsRepaired = 0;
      let responseMessage = "";

      for (const itemId of client.user.inventory.items) {
        const instance = this.itemManager.getItemInstance(itemId);
        if (instance && instance.properties?.durability) {
          itemsFound++;
          const maxDurability = instance.properties.durability.max;
          const currentDurability = instance.properties.durability.current;
          
          if (currentDurability < maxDurability) {
            // Repair the item (costs gold based on item value)
            const template = this.itemManager.getItem(instance.templateId);
            if (!template) continue;
            
            const repairCost = Math.ceil((template.value || 10) * 0.1); // 10% of item value
            
            if (client.user.inventory.currency.gold >= repairCost) {
              // Deduct gold and repair the item
              client.user.inventory.currency.gold -= repairCost;
              
              // Use the repairItem method from ItemManager to repair the item to max
              const repairAmount = maxDurability - currentDurability;
              this.itemManager.repairItem(itemId, repairAmount);
              
              itemsRepaired++;
              responseMessage += colorize(`Repaired ${this.itemManager.getItemDisplayName(itemId)} for ${repairCost} gold.\r\n`, "green");
            } else {
              responseMessage += colorize(`You need ${repairCost} gold to repair ${this.itemManager.getItemDisplayName(itemId)}.\r\n`, "red");
            }
          }
        }
      }
      
      if (itemsFound === 0) {
        writeToClient(client, colorize("You don't have any items that can be repaired.\r\n", "yellow"));
        return;
      }
      
      if (itemsRepaired === 0) {
        writeToClient(client, colorize("You couldn't afford to repair any of your items.\r\n", "red"));
        return;
      }
      
      responseMessage += colorize(`Repaired ${itemsRepaired} out of ${itemsFound} items.\r\n`, "green");
      writeToClient(client, responseMessage);
      return;
    }
    
    // Find the specific item to repair
    let itemFound = false;
    for (const itemId of client.user.inventory.items) {
      const displayName = this.itemManager.getItemDisplayName(itemId).toLowerCase();
      
      if (displayName.includes(itemName.toLowerCase())) {
        itemFound = true;
        const instance = this.itemManager.getItemInstance(itemId);
        
        if (!instance || !instance.properties?.durability) {
          writeToClient(client, colorize("That item cannot be repaired.\r\n", "yellow"));
          return;
        }
        
        const maxDurability = instance.properties.durability.max;
        const currentDurability = instance.properties.durability.current;
        
        if (currentDurability >= maxDurability) {
          writeToClient(client, colorize(`${this.itemManager.getItemDisplayName(itemId)} is already in perfect condition.\r\n`, "green"));
          return;
        }
        
        // Calculate repair cost (10% of item value)
        const template = this.itemManager.getItem(instance.templateId);
        if (!template) {
          writeToClient(client, colorize("Cannot find template for this item.\r\n", "red"));
          return;
        }
        
        const repairCost = Math.ceil((template.value || 10) * 0.1); // 10% of item value
        
        if (client.user.inventory.currency.gold < repairCost) {
          writeToClient(client, colorize(`You need ${repairCost} gold to repair this item.\r\n`, "red"));
          return;
        }
        
        // Deduct gold and repair the item
        client.user.inventory.currency.gold -= repairCost;
        
        // Use the repairItem method from ItemManager to repair to max
        const repairAmount = maxDurability - currentDurability;
        this.itemManager.repairItem(itemId, repairAmount);
        
        writeToClient(client, colorize(`You repaired ${this.itemManager.getItemDisplayName(itemId)} for ${repairCost} gold.\r\n`, "green"));
        return;
      }
    }
    
    if (!itemFound) {
      writeToClient(client, colorize(`You don't have an item called "${itemName}" in your inventory.\r\n`, "yellow"));
      return;
    }

    writeToClient(client, colorize("Something went wrong with the repair process.\r\n", "red"));
  }
}