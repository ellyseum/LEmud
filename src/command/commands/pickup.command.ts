import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';
import { UserManager } from '../../user/userManager';

export class PickupCommand implements Command {
  name = 'pickup';
  description = 'Pick up an item or currency from the room';
  aliases = ['take', 'get'];
  private roomManager: RoomManager;

  constructor(
    clients: Map<string, ConnectedClient>,
    private userManager: UserManager
  ) {
    // Use singleton instance
    this.roomManager = RoomManager.getInstance(clients);
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    // Ensure inventory structure exists
    if (!client.user.inventory) {
      client.user.inventory = {
        items: [],
        currency: { gold: 0, silver: 0, copper: 0 }
      };
    }

    if (!client.user.inventory.items) {
      client.user.inventory.items = [];
    }

    if (!client.user.inventory.currency) {
      client.user.inventory.currency = { gold: 0, silver: 0, copper: 0 };
    }

    // Handle missing arguments
    if (!args.trim()) {
      writeToClient(client, colorize("What do you want to pick up?\r\n", 'yellow'));
      return;
    }

    const roomId = client.user.currentRoomId || this.roomManager.getStartingRoomId();
    const room = this.roomManager.getRoom(roomId);
    
    if (!room) {
      writeToClient(client, colorize(`You're not in a valid room.\r\n`, 'red'));
      return;
    }

    // Check for specific currency amount pattern (e.g., "5 gold")
    const currencyMatch = args.match(/^(\d+)\s+(gold|silver|copper)$/i);
    
    if (currencyMatch) {
      const amount = parseInt(currencyMatch[1]);
      const type = currencyMatch[2].toLowerCase();
      
      // Validate amount
      if (amount <= 0) {
        writeToClient(client, colorize(`The amount must be positive.\r\n`, 'red'));
        return;
      }
      
      // Check if room has enough of that currency
      let roomHasEnough = false;
      let roomAmount = 0;
      
      if (type === 'gold' && room.currency.gold > 0) {
        roomAmount = room.currency.gold;
        roomHasEnough = roomAmount > 0;
      } else if (type === 'silver' && room.currency.silver > 0) {
        roomAmount = room.currency.silver;
        roomHasEnough = roomAmount > 0;
      } else if (type === 'copper' && room.currency.copper > 0) {
        roomAmount = room.currency.copper;
        roomHasEnough = roomAmount > 0;
      }
      
      if (!roomHasEnough) {
        writeToClient(client, colorize(`There are no ${type} pieces here.\r\n`, 'yellow'));
        return;
      }
      
      // Calculate how much we can actually pick up (min of requested and available)
      const actualAmount = Math.min(amount, roomAmount);
      
      // Update currency
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
      this.roomManager.updateRoom(room);
      this.userManager.updateUserInventory(client.user.username, client.user.inventory);
      
      // Notify the player
      if (actualAmount === amount) {
        writeToClient(client, colorize(`You pick up ${amount} ${type} piece${amount === 1 ? '' : 's'}.\r\n`, 'green'));
      } else {
        writeToClient(client, colorize(`You pick up ${actualAmount} ${type} piece${actualAmount === 1 ? '' : 's'} (all that was available).\r\n`, 'green'));
      }
      
      return;
    }

    // Check for general currency keywords (pick up all)
    const lowerArg = args.toLowerCase().trim();
    if (lowerArg === 'coins' || lowerArg === 'money' || lowerArg === 'currency' || lowerArg === 'all') {
      // Handle currency pickup
      if (room.currency.gold === 0 && room.currency.silver === 0 && room.currency.copper === 0) {
        writeToClient(client, colorize(`There is no currency here to pick up.\r\n`, 'yellow'));
        return;
      }

      // Add room's currency to player's inventory currency
      client.user.inventory.currency.gold += room.currency.gold;
      client.user.inventory.currency.silver += room.currency.silver;
      client.user.inventory.currency.copper += room.currency.copper;

      // Format currency message for output
      const currencyParts = [];
      if (room.currency.gold > 0) {
        currencyParts.push(`${room.currency.gold} gold piece${room.currency.gold === 1 ? '' : 's'}`);
      }
      if (room.currency.silver > 0) {
        currencyParts.push(`${room.currency.silver} silver piece${room.currency.silver === 1 ? '' : 's'}`);
      }
      if (room.currency.copper > 0) {
        currencyParts.push(`${room.currency.copper} copper piece${room.currency.copper === 1 ? '' : 's'}`);
      }
      
      let currencyText = currencyParts.join(', ');
      if (currencyParts.length > 1) {
        const lastPart = currencyParts.pop();
        currencyText = `${currencyParts.join(', ')}, and ${lastPart}`;
      }

      // Clear the room's currency
      room.currency = { gold: 0, silver: 0, copper: 0 };

      // Save the changes
      this.roomManager.updateRoom(room);
      this.userManager.updateUserInventory(client.user.username, client.user.inventory);

      writeToClient(client, colorize(`You pick up ${currencyText}.\r\n`, 'green'));
      return;
    }
    
    // Check for individual currency types without amounts
    if (lowerArg === 'gold' || lowerArg === 'silver' || lowerArg === 'copper') {
      const type = lowerArg;
      let amount = 0;
      
      if (type === 'gold') {
        amount = room.currency.gold;
        if (amount > 0) {
          client.user.inventory.currency.gold += amount;
          room.currency.gold = 0;
        }
      } else if (type === 'silver') {
        amount = room.currency.silver;
        if (amount > 0) {
          client.user.inventory.currency.silver += amount;
          room.currency.silver = 0;
        }
      } else if (type === 'copper') {
        amount = room.currency.copper;
        if (amount > 0) {
          client.user.inventory.currency.copper += amount;
          room.currency.copper = 0;
        }
      }
      
      if (amount > 0) {
        // Save changes
        this.roomManager.updateRoom(room);
        this.userManager.updateUserInventory(client.user.username, client.user.inventory);
        
        writeToClient(client, colorize(`You pick up ${amount} ${type} piece${amount === 1 ? '' : 's'}.\r\n`, 'green'));
      } else {
        writeToClient(client, colorize(`There are no ${type} pieces here.\r\n`, 'yellow'));
      }
      
      return;
    }

    // Handle individual items
    const itemIndex = room.objects.findIndex(item => 
      item.toLowerCase() === lowerArg || 
      item.toLowerCase().startsWith(lowerArg)
    );

    if (itemIndex !== -1) {
      const item = room.objects[itemIndex];
      // Add to inventory
      client.user.inventory.items.push(item);
      // Remove from room
      room.objects.splice(itemIndex, 1);
      
      // Save the changes
      this.roomManager.updateRoom(room);
      this.userManager.updateUserInventory(client.user.username, client.user.inventory);
      
      writeToClient(client, colorize(`You pick up the ${item}.\r\n`, 'green'));
    } else {
      writeToClient(client, colorize(`You don't see that here.\r\n`, 'red'));
    }
  }
}
