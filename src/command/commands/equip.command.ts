// filepath: /Users/jelden/projects/game/src/command/commands/equip.command.ts
import { ConnectedClient, GameItem, User, EquipmentSlot } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { ItemManager } from '../../utils/itemManager';
import { UserManager } from '../../user/userManager';

export class EquipCommand implements Command {
  name = 'equip';
  description = 'Equip an item from your inventory';
  private itemManager: ItemManager;
  private userManager: UserManager;

  constructor() {
    this.itemManager = ItemManager.getInstance();
    this.userManager = UserManager.getInstance();
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    if (!args) {
      writeToClient(client, colorize('What would you like to equip? (Usage: equip [item name])\r\n', 'red'));
      return;
    }

    const itemNameToEquip = args.toLowerCase();
    const user = client.user;
    
    // First, we need to find the item in the user's inventory
    const { itemId: matchingItemId, index: matchingItemIndex } = this.findItemInInventory(user, itemNameToEquip);
    
    if (!matchingItemId) {
      writeToClient(client, colorize(`You don't have an item called "${args}" in your inventory.\r\n`, 'red'));
      return;
    }
    
    // Get the item details
    const item = this.itemManager.getItem(matchingItemId);
    if (!item) {
      writeToClient(client, colorize(`Error: Item "${args}" found in inventory but not in the database.\r\n`, 'red'));
      return;
    }
    
    // Check if the item can be equipped (it needs a slot)
    if (!item.slot) {
      writeToClient(client, colorize(`${item.name} cannot be equipped.\r\n`, 'red'));
      return;
    }
    
    // Check item requirements
    if (!this.meetsRequirements(user, item)) {
      writeToClient(client, colorize(`You don't meet the requirements to equip ${item.name}.\r\n`, 'red'));
      
      // Show requirements
      if (item.requirements) {
        if (item.requirements.level) {
          writeToClient(client, colorize(`Requires Level: ${item.requirements.level}\r\n`, 'yellow'));
        }
        if (item.requirements.strength) {
          writeToClient(client, colorize(`Requires Strength: ${item.requirements.strength}\r\n`, 'yellow'));
        }
        if (item.requirements.dexterity) {
          writeToClient(client, colorize(`Requires Dexterity: ${item.requirements.dexterity}\r\n`, 'yellow'));
        }
      }
      return;
    }
    
    // Initialize equipment object if it doesn't exist
    if (!user.equipment) {
      user.equipment = {};
    }
    
    // Check if something is already equipped in that slot
    const currentItemId = user.equipment[item.slot];

    // Remove the specific item from inventory by its index
    if (matchingItemIndex !== -1) {
      user.inventory.items.splice(matchingItemIndex, 1);
    }
    
    if (currentItemId) {
      const currentItem = this.itemManager.getItem(currentItemId);
      
      // Return the current item to inventory if it exists
      if (currentItem) {
        // Add the current item back to inventory
        user.inventory.items.push(currentItemId);
        writeToClient(client, colorize(`You unequip ${currentItem.name}.\r\n`, 'yellow'));
      }
    }
    
    // Equip the new item
    user.equipment[item.slot] = matchingItemId;
    
    // Save user changes
    this.userManager.updateUserStats(user.username, {
      inventory: user.inventory,
      equipment: user.equipment
    });
    
    // Recalculate combat stats
    user.attack = this.itemManager.calculateAttack(user);
    user.defense = this.itemManager.calculateDefense(user);
    
    // Save the updated stats
    this.userManager.updateUserStats(user.username, {
      attack: user.attack,
      defense: user.defense
    });
    
    writeToClient(client, colorize(`You equip ${item.name}.\r\n`, 'green'));
    
    // Show any stat changes if the item has stat bonuses
    if (item.stats) {
      if (item.stats.attack) {
        writeToClient(client, colorize(`Attack: +${item.stats.attack}\r\n`, 'cyan'));
      }
      if (item.stats.defense) {
        writeToClient(client, colorize(`Defense: +${item.stats.defense}\r\n`, 'cyan'));
      }
      
      // Show attribute bonuses
      const attributes = ['strength', 'dexterity', 'agility', 'constitution', 'wisdom', 'intelligence', 'charisma'];
      attributes.forEach(attr => {
        if (item.stats && item.stats[attr as keyof typeof item.stats]) {
          const bonus = item.stats[attr as keyof typeof item.stats];
          writeToClient(client, colorize(`${attr.charAt(0).toUpperCase() + attr.slice(1)}: +${bonus}\r\n`, 'cyan'));
        }
      });
    }
  }
  
  /**
   * Find an item in the user's inventory by name (case-insensitive partial match)
   */
  private findItemInInventory(user: User, itemName: string): { itemId: string | undefined, index: number } {
    // Check if the user has any items
    if (!user.inventory || !user.inventory.items || user.inventory.items.length === 0) {
      return { itemId: undefined, index: -1 };
    }
    
    // Look for a matching item
    for (let i = 0; i < user.inventory.items.length; i++) {
      const itemId = user.inventory.items[i];
      const item = this.itemManager.getItem(itemId);
      if (item && item.name.toLowerCase().includes(itemName)) {
        return { itemId, index: i };
      }
    }
    
    return { itemId: undefined, index: -1 };
  }
  
  /**
   * Check if the user meets the requirements to equip an item
   */
  private meetsRequirements(user: User, item: GameItem): boolean {
    if (!item.requirements) return true;
    
    if (item.requirements.level && user.level < item.requirements.level) {
      return false;
    }
    
    if (item.requirements.strength && user.strength < item.requirements.strength) {
      return false;
    }
    
    if (item.requirements.dexterity && user.dexterity < item.requirements.dexterity) {
      return false;
    }
    
    return true;
  }
}