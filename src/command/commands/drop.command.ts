import { ConnectedClient, Currency } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';
import { UserManager } from '../../user/userManager';
import { ItemManager } from '../../utils/itemManager';

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
      for (const item of [...client.user.inventory.items]) { // Copy to avoid issues with array modification during iteration
        this.dropItem(client, room, item);
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
    
    // Handle normal item dropping
    this.dropItem(client, room, args);
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
  }
  
  private dropItem(client: ConnectedClient, room: any, itemNameOrId: string): void {
    if (!client.user) return;
    
    // Normalize the item name/id for easier matching
    const normalizedInput = itemNameOrId.toLowerCase();
    
    // Try to find the item by ID first
    let itemIndex = client.user.inventory.items.findIndex(id => id.toLowerCase() === normalizedInput);
    
    // If not found by ID, try to find by name
    if (itemIndex === -1) {
      itemIndex = client.user.inventory.items.findIndex(id => {
        const item = this.itemManager.getItem(id);
        return item && item.name.toLowerCase() === normalizedInput;
      });
    }
    
    // If still not found, try partial name matching
    if (itemIndex === -1) {
      itemIndex = client.user.inventory.items.findIndex(id => {
        const item = this.itemManager.getItem(id);
        return item && item.name.toLowerCase().includes(normalizedInput);
      });
    }
    
    if (itemIndex === -1) {
      writeToClient(client, colorize(`You don't have a ${itemNameOrId}.\r\n`, 'yellow'));
      return;
    }
    
    // Get the item ID from the inventory
    const itemId = client.user.inventory.items[itemIndex];
    
    // Get the actual item details from ItemManager
    const itemDetails = this.itemManager.getItem(itemId);
    
    // The display name is either the item's proper name or fallback to the ID
    const displayName = itemDetails ? itemDetails.name : itemId;
    
    // Remove the item from the player's inventory
    client.user.inventory.items.splice(itemIndex, 1);
    
    // Add the item to the room
    room.items.push(itemId);
    
    // Save changes
    const roomManager = RoomManager.getInstance(this.clients);
    roomManager.updateRoom(room);
    this.userManager.updateUserInventory(client.user.username, client.user.inventory);
    
    // Notify the player
    writeToClient(client, colorize(`You drop the ${displayName}.\r\n`, 'green'));
  }
}
