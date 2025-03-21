import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';
import { UserManager } from '../../user/userManager';

export class DropCommand implements Command {
  name = 'drop';
  description = 'Drop an item from your inventory';
  
  constructor(
    private clients: Map<string, ConnectedClient>,
    private userManager: UserManager
  ) {}
  
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
    
    // Special cases for dropping currency
    const goldMatch = args.match(/^(\d+)\s+gold$/i);
    if (goldMatch) {
      const amount = parseInt(goldMatch[1]);
      this.dropCurrency(client, room, 'gold', amount);
      return;
    }
    
    const silverMatch = args.match(/^(\d+)\s+silver$/i);
    if (silverMatch) {
      const amount = parseInt(silverMatch[1]);
      this.dropCurrency(client, room, 'silver', amount);
      return;
    }
    
    const copperMatch = args.match(/^(\d+)\s+copper$/i);
    if (copperMatch) {
      const amount = parseInt(copperMatch[1]);
      this.dropCurrency(client, room, 'copper', amount);
      return;
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
      if (client.user.inventory.currency.gold > 0) {
        this.dropCurrency(client, room, 'gold', client.user.inventory.currency.gold);
      }
      
      if (client.user.inventory.currency.silver > 0) {
        this.dropCurrency(client, room, 'silver', client.user.inventory.currency.silver);
      }
      
      if (client.user.inventory.currency.copper > 0) {
        this.dropCurrency(client, room, 'copper', client.user.inventory.currency.copper);
      }
      
      return;
    }
    
    // Handle normal item dropping
    this.dropItem(client, room, args);
  }
  
  private dropCurrency(client: ConnectedClient, room: any, type: 'gold' | 'silver' | 'copper', amount: number): void {
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
  
  private dropItem(client: ConnectedClient, room: any, itemName: string): void {
    if (!client.user) return;
    
    // Normalize the item name for easier matching
    const normalizedItemName = itemName.toLowerCase();
    
    // Find the item in the player's inventory
    const itemIndex = client.user.inventory.items.findIndex(item => item.toLowerCase() === normalizedItemName);
    
    if (itemIndex === -1) {
      writeToClient(client, colorize(`You don't have a ${itemName}.\r\n`, 'yellow'));
      return;
    }
    
    // Get the item with its proper casing
    const item = client.user.inventory.items[itemIndex];
    
    // Remove the item from the player's inventory
    client.user.inventory.items.splice(itemIndex, 1);
    
    // Add the item to the room
    room.items.push(item);
    
    // Save changes
    const roomManager = RoomManager.getInstance(this.clients);
    roomManager.updateRoom(room);
    this.userManager.updateUserInventory(client.user.username, client.user.inventory);
    
    // Notify the player
    writeToClient(client, colorize(`You drop the ${item}.\r\n`, 'green'));
  }
}
