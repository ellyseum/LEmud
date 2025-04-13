import { ConnectedClient, Currency } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';
import { UserManager } from '../../user/userManager';
import { ItemManager } from '../../utils/itemManager';
import { formatUsername } from '../../utils/formatters';
import { colorizeItemName, stripColorCodes } from '../../utils/itemNameColorizer';

// Define a type for valid currency types
type CurrencyType = keyof Currency;

export class DropCommand implements Command {
  name = 'drop';
  description = 'Drop an item or currency from your inventory. Supports partial currency names (e.g., "g", "go", "cop").';
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
      writeToClient(client, colorize(`What do you want to drop?\r\n`, 'yellow'));
      return;
    }
    
    // Get the current room
    const roomManager = RoomManager.getInstance(this.clients);
    const room = roomManager.getRoom(client.user.currentRoomId);
    
    if (!room) {
      writeToClient(client, colorize(`You're not in a valid room.\r\n`, 'red'));
      return;
    }
    
    // Check for amount with currency (e.g., "10 gold" or "5 c")
    const amountMatch = args.match(/^(\d+)\s+(.+)$/i);
    if (amountMatch) {
      const amount = parseInt(amountMatch[1]);
      const currencyName = amountMatch[2];
      const matchedCurrency = this.matchCurrency(currencyName);
      
      if (matchedCurrency) {
        this.dropCurrency(client, room, matchedCurrency, amount);
        return;
      }
    }
    
    // Handle "all" command
    if (args.toLowerCase() === 'all') {
      if (client.user.inventory.items.length === 0 && 
          client.user.inventory.currency.gold === 0 && 
          client.user.inventory.currency.silver === 0 && 
          client.user.inventory.currency.copper === 0) {
        writeToClient(client, colorize(`You have nothing to drop.\r\n`, 'yellow'));
        return;
      }
      
      // Drop all items first
      for (const itemId of [...client.user.inventory.items]) { // Copy to avoid issues with array modification during iteration
        this.dropItemInstance(client, room, itemId);
      }
      
      // Then drop all currency
      for (const type of this.currencyTypes) {
        if (client.user.inventory.currency[type] > 0) {
          this.dropCurrency(client, room, type, client.user.inventory.currency[type]);
        }
      }
      
      return;
    }
    
    // Check for single currency name (e.g., "gold" or "g")
    const matchedCurrency = this.matchCurrency(args.toLowerCase());
    if (matchedCurrency) {
      // When just the currency name is provided, drop all of that currency
      const amount = client.user.inventory.currency[matchedCurrency];
      if (amount > 0) {
        this.dropCurrency(client, room, matchedCurrency, amount);
        return;
      } else {
        writeToClient(client, colorize(`You don't have any ${matchedCurrency} pieces.\r\n`, 'yellow'));
        return;
      }
    }
    
    // Handle item dropping
    this.tryDropItem(client, room, args);
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
  
  private dropCurrency(client: ConnectedClient, room: any, type: CurrencyType, amount: number): void {
    if (!client.user) return;
    
    if (amount <= 0) {
      writeToClient(client, colorize(`You can't drop a negative or zero amount.\r\n`, 'yellow'));
      return;
    }
    
    const availableAmount = client.user.inventory.currency[type];
    
    if (availableAmount < amount) {
      writeToClient(client, colorize(`You don't have that many ${type} pieces.\r\n`, 'yellow'));
      return;
    }
    
    // Remove from player's inventory
    client.user.inventory.currency[type] -= amount;
    
    // Add to room
    room.currency[type] += amount;
    
    // Save changes
    const roomManager = RoomManager.getInstance(this.clients);
    roomManager.updateRoom(room);
    this.userManager.updateUserInventory(client.user.username, client.user.inventory);
    
    // Notify the player
    writeToClient(client, colorize(`You drop ${amount} ${type} piece${amount === 1 ? '' : 's'}.\r\n`, 'green'));
    
    // Notify others in the room
    this.notifyOthersInRoom(
      client, 
      room, 
      `${formatUsername(client.user.username)} drops ${amount} ${type} piece${amount === 1 ? '' : 's'}.\r\n`
    );
  }
  
  /**
   * Try to drop an item by name or instance ID
   */
  private tryDropItem(client: ConnectedClient, room: any, itemNameOrId: string): void {
    if (!client.user) return;
    
    // Normalize the item name/id for easier matching
    const normalizedInput = stripColorCodes(itemNameOrId.toLowerCase());
    
    // First try to find the item by exact instance ID
    const exactInstanceId = client.user.inventory.items.find(id => id === itemNameOrId);
    if (exactInstanceId) {
      this.dropItemInstance(client, room, exactInstanceId);
      return;
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
          this.dropItemInstance(client, room, instanceId);
          return;
        }
      }
    }
    
    // Second priority: Look for partial matches with custom names
    for (const instanceId of itemsWithCustomNames) {
      const instance = this.itemManager.getItemInstance(instanceId);
      if (instance && instance.properties?.customName) {
        const strippedCustomName = stripColorCodes(instance.properties.customName.toLowerCase());
        if (strippedCustomName.includes(normalizedInput)) {
          this.dropItemInstance(client, room, instanceId);
          return;
        }
      }
    }
    
    // Only if no items with custom names were matched, try to match by template name
    // but exclude items that have custom names
    const regularItems = client.user.inventory.items.filter(id => !itemsWithCustomNames.includes(id));
    
    // Third priority: Exact match on template names (only for items without custom names)
    for (const instanceId of regularItems) {
      // First try as an item instance
      const instance = this.itemManager.getItemInstance(instanceId);
      if (instance) {
        const template = this.itemManager.getItem(instance.templateId);
        if (template && stripColorCodes(template.name.toLowerCase()) === normalizedInput) {
          this.dropItemInstance(client, room, instanceId);
          return;
        }
      } else {
        // Try as a legacy item
        const item = this.itemManager.getItem(instanceId);
        if (item && stripColorCodes(item.name.toLowerCase()) === normalizedInput) {
          this.dropItemInstance(client, room, instanceId);
          return;
        }
      }
    }
    
    // Fourth priority: Partial match on template names (only for items without custom names)
    for (const instanceId of regularItems) {
      // First try as an item instance
      const instance = this.itemManager.getItemInstance(instanceId);
      if (instance) {
        const template = this.itemManager.getItem(instance.templateId);
        if (template && stripColorCodes(template.name.toLowerCase()).includes(normalizedInput)) {
          this.dropItemInstance(client, room, instanceId);
          return;
        }
      } else {
        // Try as a legacy item
        const item = this.itemManager.getItem(instanceId);
        if (item && stripColorCodes(item.name.toLowerCase()).includes(normalizedInput)) {
          this.dropItemInstance(client, room, instanceId);
          return;
        }
      }
    }
    
    writeToClient(client, colorize(`You don't have a ${itemNameOrId}.\r\n`, 'yellow'));
  }
  
  /**
   * Drop an item instance or legacy item
   * Handles partial IDs with support for disambiguating between similar IDs
   */
  private dropItemInstance(client: ConnectedClient, room: any, itemId: string): void {
    if (!client.user) return;
    
    // Check if the item is in the player's inventory by exact match
    const itemIndex = client.user.inventory.items.indexOf(itemId);
    
    // If exact match, use it
    if (itemIndex !== -1) {
      this.processDropItem(client, room, itemId, itemIndex);
      return;
    }
    
    // If no exact match but itemId is at least 8 characters, try partial match
    if (itemId.length >= 8) {
      // Check for matching IDs that start with the provided partial ID
      const matches = client.user.inventory.items.filter(id => 
        id.toLowerCase().startsWith(itemId.toLowerCase())
      );
      
      if (matches.length === 1) {
        // Found exactly one match - use it
        const matchIndex = client.user.inventory.items.indexOf(matches[0]);
        this.processDropItem(client, room, matches[0], matchIndex);
        return;
      } else if (matches.length > 1) {
        // Found multiple matches - ambiguous
        writeToClient(client, colorize(`Multiple items match '${itemId}'. Please use a longer ID to be more specific.\r\n`, 'yellow'));
        return;
      }
    }
    
    // If we get here, either the item wasn't found or the ID is too short
    writeToClient(client, colorize(`You don't have that item.\r\n`, 'yellow'));
  }
  
  /**
   * Process the actual dropping of an item
   * Separated from the lookup logic for cleaner code
   */
  private processDropItem(client: ConnectedClient, room: any, itemId: string, itemIndex: number): void {
    if (!client.user) return;
    
    // Check if it's an item instance
    const instance = this.itemManager.getItemInstance(itemId);
    if (instance) {
      // This is an item instance, handle it as such
      
      // First get the template for display purposes
      const template = this.itemManager.getItem(instance.templateId);
      if (!template) {
        writeToClient(client, colorize(`That item seems to be broken and can't be dropped.\r\n`, 'red'));
        return;
      }
      
      // Remove from player's inventory
      client.user.inventory.items.splice(itemIndex, 1);
      
      // Add to room's item instances
      room.addItemInstance(itemId, instance.templateId);
      
      // Add event to item's history
      this.itemManager.addItemHistory(
        itemId, 
        'drop', 
        `Dropped by ${client.user.username} in room ${room.id}`
      );
      
      // Save changes
      const roomManager = RoomManager.getInstance(this.clients);
      roomManager.updateRoom(room);
      this.userManager.updateUserInventory(client.user.username, client.user.inventory);
      
      // Get display name - use custom name if available, otherwise template name
      const rawDisplayName = instance.properties?.customName || template.name;
      
      // Apply color processing to the display name
      const displayName = colorizeItemName(rawDisplayName);
      
      // Notify the player
      writeToClient(client, colorize(`You drop the ${displayName}.\r\n`, 'green'));
      
      // Notify others in the room
      this.notifyOthersInRoom(
        client, 
        room, 
        `${formatUsername(client.user.username)} drops the ${displayName}.\r\n`
      );
      
      return;
    }
    
    // If not an instance, must be a legacy item
    // Get the actual item details from ItemManager for display
    const itemDetails = this.itemManager.getItem(itemId);
    
    // The display name is either the item's proper name or fallback to the ID
    const displayName = itemDetails ? itemDetails.name : itemId;
    
    // Remove the item from the player's inventory
    client.user.inventory.items.splice(itemIndex, 1);
    
    // If we can create an item instance from this legacy item, do so
    if (itemDetails) {
      // Create a new item instance
      const instance = this.itemManager.createItemInstance(itemId, client.user.username);
      
      if (instance) {
        // Add instance to the room instead of the legacy item
        room.addItemInstance(instance.instanceId, instance.templateId);
        
        // Add drop event to item's history
        this.itemManager.addItemHistory(
          instance.instanceId, 
          'drop', 
          `Dropped by ${client.user.username} in room ${room.id}`
        );
        
        // Save changes
        const roomManager = RoomManager.getInstance(this.clients);
        roomManager.updateRoom(room);
        this.userManager.updateUserInventory(client.user.username, client.user.inventory);
        
        // Notify the player
        writeToClient(client, colorize(`You drop the ${displayName}.\r\n`, 'green'));
        
        // Notify others in the room
        this.notifyOthersInRoom(
          client, 
          room, 
          `${formatUsername(client.user.username)} drops the ${displayName}.\r\n`
        );
        
        return;
      }
    }
    
    // Fall back to legacy behavior if we couldn't create an instance
    // Add the legacy item to the room
    room.items.push(itemId);
    
    // Save changes
    const roomManager = RoomManager.getInstance(this.clients);
    roomManager.updateRoom(room);
    this.userManager.updateUserInventory(client.user.username, client.user.inventory);
    
    // Notify the player
    writeToClient(client, colorize(`You drop the ${displayName}.\r\n`, 'green'));
    
    // Notify others in the room
    this.notifyOthersInRoom(
      client, 
      room, 
      `${formatUsername(client.user.username)} drops the ${displayName}.\r\n`
    );
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
}
