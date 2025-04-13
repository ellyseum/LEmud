import { ConnectedClient, GameItem, User } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { ItemManager } from '../../utils/itemManager';
import { UserManager } from '../../user/userManager';
import { colorizeItemName, stripColorCodes } from '../../utils/itemNameColorizer';
import { getPlayerLogger } from '../../utils/logger'; // Add logger import

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

    // Get player logger for this user
    const playerLogger = getPlayerLogger(client.user.username);

    if (!args) {
      writeToClient(client, colorize('What would you like to equip? (Usage: equip [item name])\r\n', 'red'));
      playerLogger.info('Equip command: No item specified');
      return;
    }

    const itemNameToEquip = args.toLowerCase();
    const user = client.user;
    
    // First, we need to find the item in the user's inventory
    const itemId = this.findItemInInventory(client, itemNameToEquip);
    
    if (!itemId) {
      writeToClient(client, colorize(`You don't have an item called "${args}" in your inventory.\r\n`, 'red'));
      playerLogger.info(`Equip command: Item "${args}" not found in inventory`);
      return;
    }
    
    // Check if this is an item instance
    const instance = this.itemManager.getItemInstance(itemId);
    let item: GameItem | undefined;
    
    if (instance) {
      // This is an item instance, get the template
      item = this.itemManager.getItem(instance.templateId);
    } else {
      // This is a legacy item ID, get it directly
      item = this.itemManager.getItem(itemId);
    }
    
    if (!item) {
      writeToClient(client, colorize(`Error: Item "${args}" found in inventory but not in the database.\r\n`, 'red'));
      playerLogger.warn(`Equip command: Item "${args}" (ID: ${itemId}) found in inventory but not in the database`);
      return;
    }
    
    // Check if the item can be equipped (it needs a slot)
    if (!item.slot) {
      writeToClient(client, colorize(`${item.name} cannot be equipped.\r\n`, 'red'));
      playerLogger.info(`Equip command: Attempted to equip non-equippable item "${item.name}" (ID: ${itemId})`);
      return;
    }
    
    // Check item requirements
    if (!this.meetsRequirements(user, item)) {
      writeToClient(client, colorize(`You don't meet the requirements to equip ${item.name}.\r\n`, 'red'));
      
      // Log requirements not met
      let reqInfo = `Equip command: Requirements not met for "${item.name}" (ID: ${itemId}) - `;
      if (item.requirements) {
        if (item.requirements.level) reqInfo += `Level req: ${item.requirements.level}, `;
        if (item.requirements.strength) reqInfo += `Strength req: ${item.requirements.strength}, `;
        if (item.requirements.dexterity) reqInfo += `Dexterity req: ${item.requirements.dexterity}`;
      }
      playerLogger.info(reqInfo);
      
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

    // Remove the item being equipped from inventory
    const itemIndex = user.inventory.items.indexOf(itemId);
    if (itemIndex !== -1) {
      user.inventory.items.splice(itemIndex, 1);
    }
    
    if (currentItemId) {
      // First check if it's an item instance
      const currentInstance = this.itemManager.getItemInstance(currentItemId);
      let currentItem: GameItem | undefined;
      
      if (currentInstance) {
        currentItem = this.itemManager.getItem(currentInstance.templateId);
      } else {
        currentItem = this.itemManager.getItem(currentItemId);
      }
      
      // Return the current item to inventory if it exists
      if (currentItem) {
        // Add the current item back to inventory
        user.inventory.items.push(currentItemId);
        writeToClient(client, colorize(`You unequip ${currentItem.name}.\r\n`, 'yellow'));
        
        // Log the unequip action
        playerLogger.info(`Unequipped item from ${item.slot} slot: ${currentItem.name} (ID: ${currentItemId})`);
        
        // Add to item instance history if applicable
        if (currentInstance) {
          this.itemManager.addItemHistory(
            currentItemId,
            'unequip',
            `Unequipped by ${user.username}`
          );
        }
      }
    }
    
    // Equip the new item
    user.equipment[item.slot] = itemId;
    
    // If it's an item instance, add to its history
    if (instance) {
      this.itemManager.addItemHistory(
        itemId,
        'equip',
        `Equipped by ${user.username} in slot ${item.slot}`
      );
    }
    
    // Save user changes
    this.userManager.updateUserStats(user.username, {
      inventory: user.inventory,
      equipment: user.equipment
    });
    
    // Recalculate combat stats
    user.attack = this.itemManager.calculateAttack(user);
    user.defense = this.itemManager.calculateDefense(user);
    
    // Apply stat bonuses from equipment - this is handled by calculateAttack/Defense already
    this.itemManager.calculateStatBonuses(user);
    
    // Update attack and defense stats
    this.userManager.updateUserStats(user.username, {
      attack: user.attack,
      defense: user.defense
    });
    
    // Get the display name - use custom name if available, otherwise use template name
    let displayName = item.name;
    if (instance && instance.properties?.customName) {
      displayName = colorizeItemName(instance.properties.customName);
    }
    
    // Display equip message with proper item name
    writeToClient(client, colorize(`You equip ${displayName}.\r\n`, 'green'));
    
    // Log the successful equip action
    playerLogger.info(`Equipped item in ${item.slot} slot: ${stripColorCodes(displayName)} (ID: ${itemId}), attack: ${user.attack}, defense: ${user.defense}`);
    
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
        const itemStats = item?.stats;
        if (itemStats && attr in itemStats) {
          const bonus = itemStats[attr as keyof typeof itemStats];
          writeToClient(client, colorize(`${attr.charAt(0).toUpperCase() + attr.slice(1)}: +${bonus}\r\n`, 'cyan'));
        }
      });
    }
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
  
  /**
   * Try to find an item in the player's inventory
   */
  private findItemInInventory(client: ConnectedClient, itemName: string): string | null {
    if (!client.user || !client.user.inventory || !client.user.inventory.items) {
      return null;
    }
    
    // Normalize the item name for easier matching
    const normalizedInput = stripColorCodes(itemName.toLowerCase());
    
    // First try to find the item by exact instance ID
    const exactInstanceId = client.user.inventory.items.find(id => id === itemName);
    if (exactInstanceId) {
      return exactInstanceId;
    }
    
    // Find all items with custom names first
    const itemsWithCustomNames: string[] = [];
    for (const instanceId of client.user.inventory.items) {
      const instance = this.itemManager.getItemInstance(instanceId);
      if (instance && instance.properties?.customName) {
        itemsWithCustomNames.push(instanceId);
      }
    }
    
    // First priority: Look for exact matches with custom names
    for (const instanceId of itemsWithCustomNames) {
      const instance = this.itemManager.getItemInstance(instanceId);
      if (instance && instance.properties?.customName) {
        const strippedCustomName = stripColorCodes(instance.properties.customName.toLowerCase());
        if (strippedCustomName === normalizedInput) {
          return instanceId;
        }
      }
    }
    
    // Second priority: Look for partial matches with custom names
    for (const instanceId of itemsWithCustomNames) {
      const instance = this.itemManager.getItemInstance(instanceId);
      if (instance && instance.properties?.customName) {
        const strippedCustomName = stripColorCodes(instance.properties.customName.toLowerCase());
        if (strippedCustomName.includes(normalizedInput)) {
          return instanceId;
        }
      }
    }
    
    // Only if no items with custom names were matched, try to match by template name
    // but exclude items that have custom names
    const regularItems = client.user.inventory.items.filter(id => !itemsWithCustomNames.includes(id));
    
    // Third priority: Look for exact template name matches (only for items without custom names)
    for (const instanceId of regularItems) {
      // Check if it's an item instance
      const instance = this.itemManager.getItemInstance(instanceId);
      if (instance) {
        const template = this.itemManager.getItem(instance.templateId);
        if (template && stripColorCodes(template.name.toLowerCase()) === normalizedInput) {
          return instanceId;
        }
      } else {
        // Check if it's a legacy item
        const item = this.itemManager.getItem(instanceId);
        if (item && stripColorCodes(item.name.toLowerCase()) === normalizedInput) {
          return instanceId;
        }
      }
    }
    
    // Fourth priority: Look for partial template name matches (only for items without custom names)
    for (const instanceId of regularItems) {
      // Check if it's an item instance
      const instance = this.itemManager.getItemInstance(instanceId);
      if (instance) {
        const template = this.itemManager.getItem(instance.templateId);
        if (template && stripColorCodes(template.name.toLowerCase()).includes(normalizedInput)) {
          return instanceId;
        }
      } else {
        // Check if it's a legacy item
        const item = this.itemManager.getItem(instanceId);
        if (item && stripColorCodes(item.name.toLowerCase()).includes(normalizedInput)) {
          return instanceId;
        }
      }
    }
    
    return null;
  }
}