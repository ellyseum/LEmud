import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';
import { UserManager } from '../../user/userManager';
import { ItemManager } from '../../utils/itemManager';

export class PickupCommand implements Command {
  name = 'pickup';
  description = 'Pick up an item from the current room';
  private itemManager: ItemManager;
  
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
    
    // Special cases for picking up currency
    if (args.toLowerCase() === 'gold' || args.toLowerCase() === 'all gold') {
      this.pickupCurrency(client, room, 'gold');
      return;
    }
    
    if (args.toLowerCase() === 'silver' || args.toLowerCase() === 'all silver') {
      this.pickupCurrency(client, room, 'silver');
      return;
    }
    
    if (args.toLowerCase() === 'copper' || args.toLowerCase() === 'all copper') {
      this.pickupCurrency(client, room, 'copper');
      return;
    }
    
    if (args.toLowerCase() === 'all coins' || args.toLowerCase() === 'all currency') {
      // Handle picking up all types of currency
      let anyPickedUp = false;
      
      if (room.currency.gold > 0) {
        this.pickupCurrency(client, room, 'gold');
        anyPickedUp = true;
      }
      
      if (room.currency.silver > 0) {
        this.pickupCurrency(client, room, 'silver');
        anyPickedUp = true;
      }
      
      if (room.currency.copper > 0) {
        this.pickupCurrency(client, room, 'copper');
        anyPickedUp = true;
      }
      
      if (!anyPickedUp) {
        writeToClient(client, colorize(`There are no coins here to pick up.\r\n`, 'yellow'));
      }
      
      return;
    }
    
    // Check for specific amounts of currency
    const goldMatch = args.match(/^(\d+)\s+gold$/i);
    if (goldMatch) {
      const amount = parseInt(goldMatch[1]);
      this.pickupSpecificCurrency(client, room, 'gold', amount);
      return;
    }
    
    const silverMatch = args.match(/^(\d+)\s+silver$/i);
    if (silverMatch) {
      const amount = parseInt(silverMatch[1]);
      this.pickupSpecificCurrency(client, room, 'silver', amount);
      return;
    }
    
    const copperMatch = args.match(/^(\d+)\s+copper$/i);
    if (copperMatch) {
      const amount = parseInt(copperMatch[1]);
      this.pickupSpecificCurrency(client, room, 'copper', amount);
      return;
    }
    
    // Handle "all" command
    if (args.toLowerCase() === 'all') {
      // First pick up all currency
      let anyPickedUp = false;
      
      if (room.currency.gold > 0) {
        this.pickupCurrency(client, room, 'gold');
        anyPickedUp = true;
      }
      
      if (room.currency.silver > 0) {
        this.pickupCurrency(client, room, 'silver');
        anyPickedUp = true;
      }
      
      if (room.currency.copper > 0) {
        this.pickupCurrency(client, room, 'copper');
        anyPickedUp = true;
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
  
  private pickupCurrency(client: ConnectedClient, room: any, type: 'gold' | 'silver' | 'copper'): void {
    if (!client.user) return;
    
    const amount = room.currency[type];
    
    if (amount <= 0) {
      writeToClient(client, colorize(`There are no ${type} pieces here.\r\n`, 'yellow'));
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
  
  private pickupSpecificCurrency(client: ConnectedClient, room: any, type: 'gold' | 'silver' | 'copper', amount: number): void {
    if (!client.user) return;
    
    if (amount <= 0) {
      writeToClient(client, colorize(`You can't pick up a negative or zero amount.\r\n`, 'yellow'));
      return;
    }
    
    const availableAmount = room.currency[type];
    
    if (availableAmount <= 0) {
      writeToClient(client, colorize(`There are no ${type} pieces here.\r\n`, 'yellow'));
      return;
    }
    
    // Calculate actual amount to pick up (not more than available)
    const actualAmount = Math.min(amount, availableAmount);
    
    // Add to player's inventory
    if (type === 'gold') {
      client.user.inventory.currency.gold += actualAmount;
      room.currency.gold -= actualAmount;
    } else if (type === 'silver') {
      client.user.inventory.currency.silver += actualAmount;
      room.currency.silver -= actualAmount;
    } else if (type === 'copper') {
      client.user.inventory.currency.copper += actualAmount;
      room.currency.copper -= actualAmount;
    }
    
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
}
