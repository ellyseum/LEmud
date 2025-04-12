import { ConnectedClient, Currency } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';
import { UserManager } from '../../user/userManager';
import { ItemManager } from '../../utils/itemManager';

// Define a type for valid currency types
type CurrencyType = keyof Currency;

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
      
      // Then pick up all items
      if (room.items.length > 0) {
        for (const item of [...room.items]) { // Create a copy to avoid issues with array modification during iteration
          const itemName = typeof item === 'string' ? item : item.name;
          this.pickupItem(client, room, itemName);
        }
        anyPickedUp = true;
      }
      
      if (!anyPickedUp) {
        writeToClient(client, colorize(`There is nothing here to pick up.\r\n`, 'yellow'));
      }
      
      return;
    }
    
    // Handle normal item pickup
    this.pickupItem(client, room, args);
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
      // This allows "get copper" to find "copper amulet" if no copper coins exist
      if (this.hasItemMatchingName(room, type)) {
        this.pickupItem(client, room, type);
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
      // This allows "get 5 copper" to find "copper amulet" if no copper coins exist
      if (this.hasItemMatchingName(room, type)) {
        this.pickupItem(client, room, type);
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
  }
  
  private pickupItem(client: ConnectedClient, room: any, itemName: string): void {
    if (!client.user) return;
    
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
    }
    
    // Remove the item from the room
    room.items.splice(itemIndex, 1);
    
    // Add the item to the player's inventory - store the ID for proper item reference
    client.user.inventory.items.push(itemId);
    
    // Save changes
    const roomManager = RoomManager.getInstance(this.clients);
    roomManager.updateRoom(room);
    this.userManager.updateUserInventory(client.user.username, client.user.inventory);
    
    // Notify the player with the proper display name
    writeToClient(client, colorize(`You pick up the ${displayName}.\r\n`, 'green'));
  }

  /**
   * Checks if there are any items in the room that match or contain the given name
   * Checks both raw item names and display names from ItemManager
   */
  private hasItemMatchingName(room: any, name: string): boolean {
    if (!room.items || room.items.length === 0) {
      return false;
    }
    
    return room.items.some((item: any) => {
      const itemName = typeof item === 'string' ? item : item.name;
      
      // Try exact match on item ID
      if (itemName.toLowerCase() === name.toLowerCase()) {
        return true;
      }
      
      // Try contains match on item ID
      if (itemName.toLowerCase().includes(name.toLowerCase())) {
        return true;
      }
      
      // Try match on displayed name from ItemManager
      if (typeof item === 'string') {
        const itemData = this.itemManager.getItem(item);
        if (itemData) {
          // Exact match on display name
          if (itemData.name.toLowerCase() === name.toLowerCase()) {
            return true;
          }
          
          // Contains match on display name
          if (itemData.name.toLowerCase().includes(name.toLowerCase())) {
            return true;
          }
        }
      }
      
      return false;
    });
  }
}
