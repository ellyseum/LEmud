import { ConnectedClient, Currency } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';
import { UserManager } from '../../user/userManager';
import { ItemManager } from '../../utils/itemManager';
import { formatUsername } from '../../utils/formatters';
import { colorizeItemName, stripColorCodes } from '../../utils/itemNameColorizer';
import { getPlayerLogger } from '../../utils/logger'; // Add logger import

// Define a type for valid currency types
type CurrencyType = keyof Currency;

// Define an extended item type that includes 'static'
type ExtendedItemType = 'weapon' | 'armor' | 'consumable' | 'quest' | 'misc' | 'static';

export class PickupCommand implements Command {
  name = 'pickup';
  description = 'Pick up an item or currency from the current room. Supports partial currency names (e.g., "g", "go", "gol" for gold).';
  private itemManager: ItemManager;
  // Define known currency types
  private currencyTypes: CurrencyType[] = ['gold', 'silver', 'copper'];
  
  constructor(
    private clients: Map<string, ConnectedClient>,
    private userManager: UserManager
  ) {
    this.itemManager = ItemManager.getInstance();
  }
  
  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;
    
    if (!args) {
      writeToClient(client, colorize(`What do you want to pick up?\r\n`, 'yellow'));
      return;
    }
    
    // Get the current room
    const roomManager = RoomManager.getInstance(this.clients);
    const room = roomManager.getRoom(client.user.currentRoomId);
    
    if (!room) {
      writeToClient(client, colorize(`You're not in a valid room.\r\n`, 'red'));
      return;
    }
    
    // Check if trying to pick up all coins or all currency
    if (args.toLowerCase() === 'all coins' || args.toLowerCase() === 'all currency') {
      // Handle picking up all types of currency
      let anyPickedUp = false;
      
      for (const type of this.currencyTypes) {
        if (room.currency[type] > 0) {
          this.pickupCurrency(client, room, type);
          anyPickedUp = true;
        }
      }
      
      if (!anyPickedUp) {
        writeToClient(client, colorize(`There are no coins here to pick up.\r\n`, 'yellow'));
      }
      
      return;
    }
    
    // Check for "all" prefix with partial currency name
    if (args.toLowerCase().startsWith('all ')) {
      const currencyName = args.toLowerCase().substring(4);
      const matchedCurrency = this.matchCurrency(currencyName);
      
      if (matchedCurrency) {
        this.pickupCurrency(client, room, matchedCurrency);
        return;
      }
    }
    
    // Check for amount with currency (e.g., "10 gold" or "5 g")
    const amountMatch = args.match(/^(\d+)\s+(.+)$/i);
    if (amountMatch) {
      const amount = parseInt(amountMatch[1]);
      const currencyName = amountMatch[2];
      const matchedCurrency = this.matchCurrency(currencyName);
      
      if (matchedCurrency) {
        this.pickupSpecificCurrency(client, room, matchedCurrency, amount);
        return;
      }
    }
    
    // Check for single currency name (e.g., "gold" or "g")
    const matchedCurrency = this.matchCurrency(args.toLowerCase());
    if (matchedCurrency) {
      this.pickupCurrency(client, room, matchedCurrency);
      return;
    }
    
    // Handle "all" command
    if (args.toLowerCase() === 'all') {
      // First pick up all currency
      let anyPickedUp = false;
      
      for (const type of this.currencyTypes) {
        if (room.currency[type] > 0) {
          this.pickupCurrency(client, room, type);
          anyPickedUp = true;
        }
      }
      
      // Then pick up all item instances
      const itemInstances = room.getItemInstances();
      if (itemInstances.size > 0) {
        for (const [instanceId, templateId] of itemInstances.entries()) {
          this.pickupItemInstance(client, room, instanceId);
        }
        anyPickedUp = true;
      }
      
      // Legacy fallback - only check if no item instances were found
      // This will gradually become less important as we migrate to item instances
      if (room.items && room.items.length > 0) {
        // Attempt to migrate each legacy item to the instance system
        for (const item of [...room.items]) { // Create a copy to avoid issues with array modification during iteration
          // Try to create a new instance for this legacy item
          const itemId = typeof item === 'string' ? item : item.name;
          const itemData = this.itemManager.getItem(itemId);
          
          if (itemData) {
            // Create a new instance and pick it up (removing the legacy item)
            const instance = this.itemManager.createItemInstance(itemId, client.user.username);
            if (instance) {
              // Remove the legacy item from the room
              const itemIndex = room.items.indexOf(item);
              if (itemIndex !== -1) {
                room.items.splice(itemIndex, 1);
              }
              
              // Add the instance to the player's inventory
              client.user.inventory.items.push(instance.instanceId);
              
              // Notify the player (without duplicating notifications)
              if (!anyPickedUp) {
                writeToClient(client, colorize(`You pick up the ${itemData.name}.\r\n`, 'green'));
                
                // Notify others in the room
                this.notifyOthersInRoom(
                  client, 
                  room, 
                  `${formatUsername(client.user.username)} picks up the ${itemData.name}.\r\n`
                );
              }
              
              anyPickedUp = true;
            }
          } else {
            // If we can't create an instance, fall back to legacy pickup
            this.pickupLegacyItem(client, room, itemId);
            anyPickedUp = true;
          }
        }
      }
      
      if (!anyPickedUp) {
        writeToClient(client, colorize(`There is nothing here to pick up.\r\n`, 'yellow'));
      }
      
      // Save changes
      roomManager.updateRoom(room);
      this.userManager.updateUserInventory(client.user.username, client.user.inventory);
      
      return;
    }
    
    // Try to pick up an item instance first
    if (this.tryPickupItemInstance(client, room, args)) {
      return;
    }
    
    // Only if no item instance was found, try to migrate or fall back to legacy items
    this.tryMigrateOrPickupLegacyItem(client, room, args);
  }
  
  /**
   * Try to migrate a legacy item to an instance or pick it up as a legacy item
   */
  private tryMigrateOrPickupLegacyItem(client: ConnectedClient, room: any, itemName: string): void {
    if (!client.user || !room.items) return;
    
    // Find the item in the room
    let itemIndex = room.items.findIndex((item: any) => {
      const name = typeof item === 'string' ? item : item.name;
      
      // Try to match by item ID directly
      if (name.toLowerCase() === itemName.toLowerCase()) {
        return true;
      }
      
      // Try to match by displayed name (looking up in ItemManager)
      if (typeof item === 'string') {
        const itemData = this.itemManager.getItem(item);
        if (itemData && itemData.name.toLowerCase() === itemName.toLowerCase()) {
          return true;
        }
      }
      
      return false;
    });
    
    if (itemIndex === -1) {
      // Second pass: try partial matching for convenience
      const itemIndexPartial = room.items.findIndex((item: any) => {
        const name = typeof item === 'string' ? item : item.name;
        
        // Try partial match on item ID
        if (name.toLowerCase().includes(itemName.toLowerCase())) {
          return true;
        }
        
        // Try partial match on displayed name
        if (typeof item === 'string') {
          const itemData = this.itemManager.getItem(item);
          if (itemData && itemData.name.toLowerCase().includes(itemName.toLowerCase())) {
            return true;
          }
        }
        
        return false;
      });
      
      if (itemIndexPartial === -1) {
        writeToClient(client, colorize(`You don't see a ${itemName} here.\r\n`, 'yellow'));
        return;
      } else {
        // Use the partial match index
        itemIndex = itemIndexPartial;
      }
    }
    
    // Get the item (it could be a string or an object)
    const item = room.items[itemIndex];
    
    // Keep the original ID for inventory (we want to store the ID in inventory)
    const itemId = typeof item === 'string' ? item : item.name;
    
    // Get proper display name from ItemManager
    let displayName = itemId;
    const itemData = this.itemManager.getItem(itemId);
    if (itemData) {
      displayName = itemData.name;
      
      // Check if the item is static (cannot be picked up)
      if ((itemData.type as ExtendedItemType) === 'static') {
        writeToClient(client, colorize(`The ${displayName} cannot be moved.\r\n`, 'yellow'));
        return;
      }
      
      // Try to migrate this legacy item to the new instance system
      const instance = this.itemManager.createItemInstance(itemId, client.user.username);
      
      if (instance) {
        // Remove the legacy item from the room
        room.items.splice(itemIndex, 1);
        
        // Add the instance to the player's inventory
        client.user.inventory.items.push(instance.instanceId);
        
        // Add event to item's history
        this.itemManager.addItemHistory(
          instance.instanceId,
          'pickup',
          `Picked up by ${client.user.username} from room ${room.id} (migrated from legacy item)`
        );
        
        // Save changes
        const roomManager = RoomManager.getInstance(this.clients);
        roomManager.updateRoom(room);
        this.userManager.updateUserInventory(client.user.username, client.user.inventory);
        
        // Notify the player with the proper display name
        writeToClient(client, colorize(`You pick up the ${displayName}.\r\n`, 'green'));
        
        // Notify others in the room
        this.notifyOthersInRoom(
          client, 
          room, 
          `${formatUsername(client.user.username)} picks up the ${displayName}.\r\n`
        );
        
        return;
      }
    }
    
    // If we couldn't create an instance, fall back to the legacy behavior
    this.pickupLegacyItem(client, room, itemName);
  }
  
  /**
   * Match a partial currency name to a full currency type
   * Returns the full currency type if a match is found, otherwise null
   */
  private matchCurrency(partialName: string): CurrencyType | null {
    // Empty string is not a match
    if (!partialName) return null;
    
    // First try exact matches
    for (const type of this.currencyTypes) {
      if (type === partialName) {
        return type;
      }
    }
    
    // Then try partial matches (starts with)
    for (const type of this.currencyTypes) {
      if (type.startsWith(partialName)) {
        return type;
      }
    }
    
    return null;
  }
  
  private pickupCurrency(client: ConnectedClient, room: any, type: CurrencyType): void {
    if (!client.user) return;
    
    const amount = room.currency[type];
    
    if (amount <= 0) {
      // Check if there are any items that contain the currency name
      if (this.hasItemInstanceMatchingName(room, type) || this.hasLegacyItemMatchingName(room, type)) {
        // First try to pick up an item instance with that name
        if (!this.tryPickupItemInstance(client, room, type)) {
          // Fall back to legacy items, but try to migrate them
          this.tryMigrateOrPickupLegacyItem(client, room, type);
        }
      } else {
        writeToClient(client, colorize(`There are no ${type} pieces here.\r\n`, 'yellow'));
      }
      return;
    }
    
    // Add to player's inventory
    client.user.inventory.currency[type] += amount;
    
    // Remove from room
    room.currency[type] = 0;
    
    // Save changes
    const roomManager = RoomManager.getInstance(this.clients);
    roomManager.updateRoom(room);
    this.userManager.updateUserInventory(client.user.username, client.user.inventory);
    
    // Notify the player
    writeToClient(client, colorize(`You pick up ${amount} ${type} piece${amount === 1 ? '' : 's'}.\r\n`, 'green'));
    
    // Notify others in the room
    this.notifyOthersInRoom(
      client, 
      room, 
      `${formatUsername(client.user.username)} picks up ${amount} ${type} piece${amount === 1 ? '' : 's'}.\r\n`
    );
    
    // Log the currency pickup
    const playerLogger = getPlayerLogger(client.user.username);
    playerLogger.info(`Picked up ${amount} ${type} piece${amount === 1 ? '' : 's'} from room ${room.id}`);
  }
  
  private pickupSpecificCurrency(client: ConnectedClient, room: any, type: CurrencyType, amount: number): void {
    if (!client.user) return;
    
    if (amount <= 0) {
      writeToClient(client, colorize(`You can't pick up a negative or zero amount.\r\n`, 'yellow'));
      return;
    }
    
    const availableAmount = room.currency[type];
    
    if (availableAmount <= 0) {
      // Check if there are any items that contain the currency name
      if (this.hasItemInstanceMatchingName(room, type) || this.hasLegacyItemMatchingName(room, type)) {
        // First try to pick up an item instance with that name
        if (!this.tryPickupItemInstance(client, room, type)) {
          // Fall back to legacy items, but try to migrate them
          this.tryMigrateOrPickupLegacyItem(client, room, type);
        }
      } else {
        writeToClient(client, colorize(`There are no ${type} pieces here.\r\n`, 'yellow'));
      }
      return;
    }
    
    // Calculate actual amount to pick up (not more than available)
    const actualAmount = Math.min(amount, availableAmount);
    
    // Add to player's inventory
    client.user.inventory.currency[type] += actualAmount;
    room.currency[type] -= actualAmount;
    
    // Save changes
    const roomManager = RoomManager.getInstance(this.clients);
    roomManager.updateRoom(room);
    this.userManager.updateUserInventory(client.user.username, client.user.inventory);
    
    // Notify the player
    if (actualAmount === amount) {
      writeToClient(client, colorize(`You pick up ${amount} ${type} piece${amount === 1 ? '' : 's'}.\r\n`, 'green'));
    } else {
      writeToClient(client, colorize(`You pick up ${actualAmount} ${type} piece${actualAmount === 1 ? '' : 's'} (all that was available).\r\n`, 'green'));
    }
    
    // Notify others in the room
    this.notifyOthersInRoom(
      client, 
      room, 
      `${formatUsername(client.user.username)} picks up ${actualAmount} ${type} piece${actualAmount === 1 ? '' : 's'}.\r\n`
    );
    
    // Log the currency pickup - include specified and actual amount
    const playerLogger = getPlayerLogger(client.user.username);
    if (actualAmount === amount) {
      playerLogger.info(`Picked up ${amount} ${type} piece${amount === 1 ? '' : 's'} from room ${room.id}`);
    } else {
      playerLogger.info(`Picked up ${actualAmount} ${type} piece${actualAmount === 1 ? '' : 's'} (requested: ${amount}) from room ${room.id}`);
    }
  }
  
  /**
   * Try to pick up an item instance from the room by instance ID or name
   * @returns true if an item was found and picked up, false otherwise
   */
  private tryPickupItemInstance(client: ConnectedClient, room: any, itemIdentifier: string): boolean {
    if (!client.user) return false;
    
    const itemInstances = room.getItemInstances();
    if (itemInstances.size === 0) return false;
    
    // Normalize the input for case-insensitive comparison and strip color codes
    const normalizedInput = stripColorCodes(itemIdentifier.toLowerCase());
    
    // First, check if the itemIdentifier is an exact instance ID
    if (itemInstances.has(itemIdentifier)) {
      this.pickupItemInstance(client, room, itemIdentifier);
      return true;
    }
    
    // Track items with custom names to prioritize them
    const itemsWithCustomNames: string[] = [];
    
    // First find all items with custom names
    for (const [instanceId, _templateId] of itemInstances.entries()) {
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
          this.pickupItemInstance(client, room, instanceId);
          return true;
        }
      }
    }
    
    // Second priority: Look for partial matches with custom names
    for (const instanceId of itemsWithCustomNames) {
      const instance = this.itemManager.getItemInstance(instanceId);
      if (instance && instance.properties?.customName) {
        const strippedCustomName = stripColorCodes(instance.properties.customName.toLowerCase());
        if (strippedCustomName.includes(normalizedInput)) {
          this.pickupItemInstance(client, room, instanceId);
          return true;
        }
      }
    }
    
    // Only if no items with custom names were matched, try to match by template name
    // but exclude items that have custom names
    const entries = Array.from(itemInstances.entries()) as Array<[string, string]>;
    const regularItems = entries.filter(
      (entry) => !itemsWithCustomNames.includes(entry[0])
    );
    
    // Third priority: Look for exact template name matches (only for items without custom names)
    for (const entry of regularItems) {
      const instanceId = entry[0];
      const templateId = entry[1];
      const template = this.itemManager.getItem(templateId);
      if (template && stripColorCodes(template.name.toLowerCase()) === normalizedInput) {
        this.pickupItemInstance(client, room, instanceId);
        return true;
      }
    }
    
    // Finally, try partial template name matching (only for items without custom names)
    for (const entry of regularItems) {
      const instanceId = entry[0];
      const templateId = entry[1];
      const template = this.itemManager.getItem(templateId);
      if (template && stripColorCodes(template.name.toLowerCase()).includes(normalizedInput)) {
        this.pickupItemInstance(client, room, instanceId);
        return true;
      }
    }
    
    // No matching item instance found
    return false;
  }
  
  /**
   * Pick up a specific item instance from the room by instance ID
   * Now supports partial IDs with proper handling of ambiguous cases
   */
  private pickupItemInstance(client: ConnectedClient, room: any, instanceId: string): void {
    if (!client.user) return;
    
    // If this is an exact match, use it directly
    if (room.itemInstances.has(instanceId)) {
      this.processPickupItem(client, room, instanceId);
      return;
    }
    
    // If not an exact match but at least 8 characters long, try partial match
    if (instanceId.length >= 8) {
      // Try to find the item by partial ID
      const matchedId = room.findItemInstanceId(instanceId);
      
      // If undefined, it means multiple items matched (ambiguous)
      if (matchedId === undefined) {
        writeToClient(client, colorize(`Multiple items match '${instanceId}'. Please use a longer ID to be more specific.\r\n`, 'yellow'));
        return;
      }
      
      // If a unique match was found, use it
      if (matchedId) {
        this.processPickupItem(client, room, matchedId);
        return;
      }
    }
    
    // If we get here, the item instance wasn't found
    writeToClient(client, colorize(`That item is not here.\r\n`, 'yellow'));
  }
  
  /**
   * Process the actual pickup of an item
   * Separated from the lookup logic for cleaner code
   */
  private processPickupItem(client: ConnectedClient, room: any, instanceId: string): void {
    if (!client.user) return;
    
    // Get the instance and template data for display purposes
    const templateId = room.getItemInstances().get(instanceId);
    const instance = this.itemManager.getItemInstance(instanceId);
    const template = this.itemManager.getItem(templateId);
    
    if (!template) {
      writeToClient(client, colorize(`That item seems to be broken and can't be picked up.\r\n`, 'red'));
      return;
    }
    
    // Check if the item is static (cannot be picked up)
    if ((template.type as ExtendedItemType) === 'static') {
      writeToClient(client, colorize(`The ${template.name} cannot be moved.\r\n`, 'yellow'));
      return;
    }
    
    // Get the raw display name (use custom name if it exists, otherwise template name)
    const rawDisplayName = instance?.properties?.customName || template.name;
    
    // Colorize the display name with quality-based colors - handle null instance case
    const displayName = colorizeItemName(
      rawDisplayName, 
      'white', 
      instance === null ? undefined : instance
    );
    
    // Remove the item from the room
    room.removeItemInstance(instanceId);
    
    // Add the item to the player's inventory
    client.user.inventory.items.push(instanceId);
    
    // Add event to item's history
    this.itemManager.addItemHistory(
      instanceId, 
      'pickup', 
      `Picked up by ${client.user.username} from room ${room.id}`
    );
    
    // Save changes
    const roomManager = RoomManager.getInstance(this.clients);
    roomManager.updateRoom(room);
    this.userManager.updateUserInventory(client.user.username, client.user.inventory);
    
    // Notify the player with colorized name
    writeToClient(client, colorize(`You pick up the ${displayName}.\r\n`, 'green'));
    
    // Notify others in the room
    this.notifyOthersInRoom(
      client, 
      room, 
      `${formatUsername(client.user.username)} picks up the ${displayName}.\r\n`
    );
    
    // Log the pickup action - record more details for better tracking
    const playerLogger = getPlayerLogger(client.user.username);
    playerLogger.info(`Picked up item: ${stripColorCodes(rawDisplayName)} (ID: ${instanceId}) from room ${room.id}`);
  }
  
  /**
   * Legacy method for picking up items from the old system
   * @deprecated Use tryMigrateOrPickupLegacyItem instead which attempts to migrate to the new instance system
   */
  private pickupLegacyItem(client: ConnectedClient, room: any, itemName: string): void {
    if (!client.user || !room.items) return;
    
    // Find the item in the room
    let itemIndex = room.items.findIndex((item: any) => {
      const name = typeof item === 'string' ? item : item.name;
      
      // Try to match by item ID directly
      if (name.toLowerCase() === itemName.toLowerCase()) {
        return true;
      }
      
      // Try to match by displayed name (looking up in ItemManager)
      if (typeof item === 'string') {
        const itemData = this.itemManager.getItem(item);
        if (itemData && itemData.name.toLowerCase() === itemName.toLowerCase()) {
          return true;
        }
      }
      
      return false;
    });
    
    if (itemIndex === -1) {
      // Second pass: try partial matching for convenience
      const itemIndexPartial = room.items.findIndex((item: any) => {
        const name = typeof item === 'string' ? item : item.name;
        
        // Try partial match on item ID
        if (name.toLowerCase().includes(itemName.toLowerCase())) {
          return true;
        }
        
        // Try partial match on displayed name
        if (typeof item === 'string') {
          const itemData = this.itemManager.getItem(item);
          if (itemData && itemData.name.toLowerCase().includes(itemName.toLowerCase())) {
            return true;
          }
        }
        
        return false;
      });
      
      if (itemIndexPartial === -1) {
        writeToClient(client, colorize(`You don't see a ${itemName} here.\r\n`, 'yellow'));
        return;
      } else {
        // Use the partial match index
        itemIndex = itemIndexPartial;
      }
    }
    
    const item = room.items[itemIndex];
    const itemId = typeof item === 'string' ? item : item.name;
    
    // Get proper display name from ItemManager
    let displayName = itemId;
    const itemData = this.itemManager.getItem(itemId);
    if (itemData) {
      displayName = itemData.name;
    }
    
    // Remove the item from the room
    room.items.splice(itemIndex, 1);
    
    // Add the item to the player's inventory
    client.user.inventory.items.push(itemId);
    
    // Save changes
    const roomManager = RoomManager.getInstance(this.clients);
    roomManager.updateRoom(room);
    this.userManager.updateUserInventory(client.user.username, client.user.inventory);
    
    // Notify the player with the proper display name
    writeToClient(client, colorize(`You pick up the ${displayName}.\r\n`, 'green'));
    
    // Notify others in the room
    this.notifyOthersInRoom(
      client, 
      room, 
      `${formatUsername(client.user.username)} picks up the ${displayName}.\r\n`
    );
    
    // Log the legacy item pickup
    const playerLogger = getPlayerLogger(client.user.username);
    playerLogger.info(`Picked up legacy item: ${displayName} (ID: ${itemId}) from room ${room.id}`);
  }

  /**
   * Notify other players in the room about an action
   */
  private notifyOthersInRoom(client: ConnectedClient, room: any, message: string): void {
    if (!client.user) return;
    
    // Look for other clients in the room
    for (const otherUsername of room.players) {
      // Skip the current client
      if (otherUsername === client.user.username) continue;
      
      // Find the other client
      for (const [_, otherClient] of this.clients.entries()) {
        if (otherClient.user && otherClient.user.username === otherUsername) {
          writeToClient(otherClient, colorize(message, 'green'));
          break;
        }
      }
    }
  }

  /**
   * Checks if there are any item instances in the room that match the given name
   */
  private hasItemInstanceMatchingName(room: any, name: string): boolean {
    const itemInstances = room.getItemInstances();
    if (itemInstances.size === 0) {
      return false;
    }
    
    for (const [instanceId, templateId] of itemInstances.entries()) {
      const template = this.itemManager.getItem(templateId);
      if (template) {
        // Check exact match
        if (stripColorCodes(template.name.toLowerCase()) === name.toLowerCase()) {
          return true;
        }
        
        // Check partial match
        if (stripColorCodes(template.name.toLowerCase()).includes(name.toLowerCase())) {
          return true;
        }
      }
      
      // Check instance custom name if it exists
      const instance = this.itemManager.getItemInstance(instanceId);
      if (instance && 
          instance.properties?.customName && 
          stripColorCodes(instance.properties.customName.toLowerCase()) === name.toLowerCase()) {
        return true;
      }
      
      if (instance && 
          instance.properties?.customName && 
          stripColorCodes(instance.properties.customName.toLowerCase()).includes(name.toLowerCase())) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Checks if there are any legacy items in the room that match or contain the given name
   * Checks both raw item names and display names from ItemManager
   * @deprecated Use hasItemInstanceMatchingName instead whenever possible
   */
  private hasLegacyItemMatchingName(room: any, name: string): boolean {
    if (!room.items || room.items.length === 0) {
      return false;
    }
    
    return room.items.some((item: any) => {
      const itemName = typeof item === 'string' ? item : item.name;
      
      // Try exact match on item ID
      if (stripColorCodes(itemName.toLowerCase()) === name.toLowerCase()) {
        return true;
      }
      
      // Try contains match on item ID
      if (stripColorCodes(itemName.toLowerCase()).includes(name.toLowerCase())) {
        return true;
      }
      
      // Try match on displayed name from ItemManager
      if (typeof item === 'string') {
        const itemData = this.itemManager.getItem(item);
        if (itemData) {
          // Exact match on display name
          if (stripColorCodes(itemData.name.toLowerCase()) === name.toLowerCase()) {
            return true;
          }
          
          // Contains match on display name
          if (stripColorCodes(itemData.name.toLowerCase()).includes(name.toLowerCase())) {
            return true;
          }
        }
      }
      
      return false;
    });
  }
}
