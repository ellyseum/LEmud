import { ConnectedClient, EquipmentSlot } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { ItemManager } from '../../utils/itemManager';
import { UserManager } from '../../user/userManager';
import { colorizeItemName, stripColorCodes } from '../../utils/itemNameColorizer';

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
    const searchTerm = stripColorCodes(args.toLowerCase());
    
    // First try to match by slot
    const matchedSlot = slotNames.find(slot => slot.toLowerCase() === searchTerm);
    
    if (matchedSlot) {
      // Found a matching slot name
      this.unequipSlot(client, matchedSlot);
      return;
    }
    
    // Pretty display version of slot names for better user feedback
    const displaySlotNames = slotNames.map(slot => 
      slot.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ')
    );
    
    // Collect all items with custom names
    const itemsWithCustomNames = new Map<string, string>(); // slot -> custom name
    
    for (const [slot, itemId] of Object.entries(user.equipment)) {
      const instance = this.itemManager.getItemInstance(itemId);
      if (instance && instance.properties?.customName) {
        itemsWithCustomNames.set(slot, instance.properties.customName);
      }
    }
    
    // First priority: Check for exact match with custom names
    for (const [slot, customName] of itemsWithCustomNames.entries()) {
      const strippedCustomName = stripColorCodes(customName.toLowerCase());
      if (strippedCustomName === searchTerm) {
        this.unequipSlot(client, slot);
        return;
      }
    }
    
    // Second priority: Check for partial match with custom names
    for (const [slot, customName] of itemsWithCustomNames.entries()) {
      const strippedCustomName = stripColorCodes(customName.toLowerCase());
      if (strippedCustomName.includes(searchTerm)) {
        this.unequipSlot(client, slot);
        return;
      }
    }
    
    // Only if no custom named items match, try to match by template name
    // but exclude slots with custom named items
    const slotsWithoutCustomNames = slotNames.filter(slot => !itemsWithCustomNames.has(slot));
    
    // Third priority: Check exact match by template name for non-custom items
    for (const slot of slotsWithoutCustomNames) {
      const itemId = user.equipment[slot];
      const instance = this.itemManager.getItemInstance(itemId);
      
      if (instance) {
        const template = this.itemManager.getItem(instance.templateId);
        if (template && stripColorCodes(template.name.toLowerCase()) === searchTerm) {
          this.unequipSlot(client, slot);
          return;
        }
      } else {
        const item = this.itemManager.getItem(itemId);
        if (item && stripColorCodes(item.name.toLowerCase()) === searchTerm) {
          this.unequipSlot(client, slot);
          return;
        }
      }
    }
    
    // Fourth priority: Check partial match by template name for non-custom items
    for (const slot of slotsWithoutCustomNames) {
      const itemId = user.equipment[slot];
      const instance = this.itemManager.getItemInstance(itemId);
      
      if (instance) {
        const template = this.itemManager.getItem(instance.templateId);
        if (template && stripColorCodes(template.name.toLowerCase()).includes(searchTerm)) {
          this.unequipSlot(client, slot);
          return;
        }
      } else {
        const item = this.itemManager.getItem(itemId);
        if (item && stripColorCodes(item.name.toLowerCase()).includes(searchTerm)) {
          this.unequipSlot(client, slot);
          return;
        }
      }
    }
    
    // If we get here, no matching item was found
    writeToClient(client, colorize(`You don't have anything called "${args}" equipped.\r\n`, 'red'));
    writeToClient(client, colorize(`Available slots: ${displaySlotNames.join(', ')}\r\n`, 'yellow'));
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
    
    // Prepare pretty slot name for display
    const displaySlotName = slot.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
    
    // Check if it's an item instance or a legacy item
    const instance = this.itemManager.getItemInstance(itemId);
    let itemName = '';
    
    if (instance) {
      // It's an item instance
      const template = this.itemManager.getItem(instance.templateId);
      
      if (!template) {
        writeToClient(client, colorize(`Error: Item template not found for item in ${displaySlotName} slot.\r\n`, 'red'));
        return;
      }
      
      // Use custom name if available, otherwise use template name
      if (instance.properties?.customName) {
        itemName = colorizeItemName(instance.properties.customName);
      } else {
        itemName = template.name;
      }
      
      // Add to item instance history
      this.itemManager.addItemHistory(
        itemId,
        'unequip',
        `Unequipped from ${displaySlotName} slot by ${user.username}`
      );
    } else {
      // It's a legacy item
      const item = this.itemManager.getItem(itemId);
      
      if (!item) {
        writeToClient(client, colorize(`Error: Item in ${displaySlotName} slot not found in the database.\r\n`, 'red'));
        return;
      }
      
      itemName = item.name;
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
    
    writeToClient(client, colorize(`You unequip ${itemName} `, 'green') + colorize(`from your ${displaySlotName} slot.\r\n`, 'green'));
    
    // Get item stats for showing the changes
    let itemStats: { 
      attack?: number; 
      defense?: number;
      strength?: number;
      dexterity?: number;
      agility?: number;
      constitution?: number;
      wisdom?: number;
      intelligence?: number;
      charisma?: number;
      [key: string]: number | undefined;
    } = {};
    
    if (instance) {
      const template = this.itemManager.getItem(instance.templateId);
      if (template?.stats) {
        itemStats = template.stats;
      }
    } else {
      const item = this.itemManager.getItem(itemId);
      if (item?.stats) {
        itemStats = item.stats;
      }
    }
    
    // Show stat changes lost, if any
    if (itemStats.attack) {
      writeToClient(client, colorize(`Attack: -${itemStats.attack}\r\n`, 'yellow'));
    }
    if (itemStats.defense) {
      writeToClient(client, colorize(`Defense: -${itemStats.defense}\r\n`, 'yellow'));
    }
    
    // Show attribute bonuses lost
    const attributes = ['strength', 'dexterity', 'agility', 'constitution', 'wisdom', 'intelligence', 'charisma'];
    attributes.forEach(attr => {
      if (itemStats && attr in itemStats) {
        const bonus = itemStats[attr as keyof typeof itemStats];
        writeToClient(client, colorize(`${attr.charAt(0).toUpperCase() + attr.slice(1)}: -${bonus}\r\n`, 'yellow'));
      }
    });
  }
}