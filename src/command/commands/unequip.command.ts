// filepath: /Users/jelden/projects/game/src/command/commands/unequip.command.ts
import { ConnectedClient, EquipmentSlot } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { ItemManager } from '../../utils/itemManager';
import { UserManager } from '../../user/userManager';

export class UnequipCommand implements Command {
  name = 'unequip';
  description = 'Unequip an item and return it to your inventory';
  private itemManager: ItemManager;
  private userManager: UserManager;

  constructor() {
    this.itemManager = ItemManager.getInstance();
    this.userManager = UserManager.getInstance();
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    if (!args) {
      writeToClient(client, colorize('What would you like to unequip? (Usage: unequip [item name or slot])\r\n', 'red'));
      return;
    }

    const user = client.user;
    
    // Check if user has equipment
    if (!user.equipment || Object.keys(user.equipment).length === 0) {
      writeToClient(client, colorize(`You don't have any equipment equipped.\r\n`, 'red'));
      return;
    }
    
    // Check if they're trying to unequip by slot name
    const slotNames = Object.keys(user.equipment);
    const searchTerm = args.toLowerCase();
    
    // First try to match by slot
    const matchedSlot = slotNames.find(slot => slot.toLowerCase() === searchTerm);
    
    if (matchedSlot) {
      // Found a matching slot name
      this.unequipSlot(client, matchedSlot);
      return;
    }
    
    // If not found by slot, try to match by item name
    let foundItem = false;
    
    for (const [slot, itemId] of Object.entries(user.equipment)) {
      const item = this.itemManager.getItem(itemId);
      
      if (item && item.name.toLowerCase().includes(searchTerm)) {
        this.unequipSlot(client, slot);
        foundItem = true;
        break;
      }
    }
    
    if (!foundItem) {
      writeToClient(client, colorize(`You don't have anything called "${args}" equipped.\r\n`, 'red'));
      writeToClient(client, colorize(`Available slots: ${slotNames.join(', ')}\r\n`, 'yellow'));
    }
  }
  
  /**
   * Unequip an item from a specific slot
   */
  private unequipSlot(client: ConnectedClient, slot: string): void {
    const user = client.user;
    if (!user || !user.equipment) return;
    
    const itemId = user.equipment[slot];
    if (!itemId) {
      writeToClient(client, colorize(`You don't have anything equipped in the ${slot} slot.\r\n`, 'red'));
      return;
    }
    
    // Get the item details
    const item = this.itemManager.getItem(itemId);
    if (!item) {
      writeToClient(client, colorize(`Error: Item in ${slot} slot not found in the database.\r\n`, 'red'));
      return;
    }
    
    // Add the item back to the inventory
    if (!user.inventory.items) {
      user.inventory.items = [];
    }
    user.inventory.items.push(itemId);
    
    // Remove the item from the equipment
    delete user.equipment[slot];
    
    // Save changes
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
    
    writeToClient(client, colorize(`You unequip ${item.name} from your ${slot} slot.\r\n`, 'green'));
    
    // Show stat changes lost, if any
    if (item.stats) {
      if (item.stats.attack) {
        writeToClient(client, colorize(`Attack: -${item.stats.attack}\r\n`, 'yellow'));
      }
      if (item.stats.defense) {
        writeToClient(client, colorize(`Defense: -${item.stats.defense}\r\n`, 'yellow'));
      }
      
      // Show attribute bonuses lost
      const attributes = ['strength', 'dexterity', 'agility', 'constitution', 'wisdom', 'intelligence', 'charisma'];
      attributes.forEach(attr => {
        if (item.stats && item.stats[attr as keyof typeof item.stats]) {
          const bonus = item.stats[attr as keyof typeof item.stats];
          writeToClient(client, colorize(`${attr.charAt(0).toUpperCase() + attr.slice(1)}: -${bonus}\r\n`, 'yellow'));
        }
      });
    }
  }
}