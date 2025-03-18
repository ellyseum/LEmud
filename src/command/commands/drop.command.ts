import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';
import { UserManager } from '../../user/userManager';

export class DropCommand implements Command {
  name = 'drop';
  description = 'Drop an item or currency from your inventory';

  constructor(
    private roomManager: RoomManager,
    private userManager: UserManager
  ) {}

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
      writeToClient(client, colorize("What do you want to drop?\r\n", 'yellow'));
      return;
    }

    const roomId = client.user.currentRoomId || this.roomManager.getStartingRoomId();
    const room = this.roomManager.getRoom(roomId);
    
    if (!room) {
      writeToClient(client, colorize(`You're not in a valid room.\r\n`, 'red'));
      return;
    }

    // Parse the input for potential currency drops
    const match = args.match(/^(\d+)\s+(gold|silver|copper)$/i);
    
    if (match) {
      const amount = parseInt(match[1]);
      const type = match[2].toLowerCase();
      
      // Check if player has enough of that currency
      if (amount <= 0) {
        writeToClient(client, colorize(`The amount must be positive.\r\n`, 'red'));
        return;
      }
      
      let playerHasAmount = false;
      
      if (type === 'gold' && client.user.inventory.currency.gold >= amount) {
        client.user.inventory.currency.gold -= amount;
        room.currency.gold += amount;
        playerHasAmount = true;
      } else if (type === 'silver' && client.user.inventory.currency.silver >= amount) {
        client.user.inventory.currency.silver -= amount;
        room.currency.silver += amount;
        playerHasAmount = true;
      } else if (type === 'copper' && client.user.inventory.currency.copper >= amount) {
        client.user.inventory.currency.copper -= amount;
        room.currency.copper += amount;
        playerHasAmount = true;
      }
      
      if (playerHasAmount) {
        // Save the changes
        this.roomManager.updateRoom(room);
        this.userManager.updateUserInventory(client.user.username, client.user.inventory);
        
        writeToClient(client, colorize(`You drop ${amount} ${type} ${amount === 1 ? 'piece' : 'pieces'}.\r\n`, 'green'));
      } else {
        writeToClient(client, colorize(`You don't have that many ${type} pieces.\r\n`, 'red'));
      }
      
      return;
    }

    // Handle individual items from inventory
    const lowerArg = args.toLowerCase().trim();
    const itemIndex = client.user.inventory.items.findIndex(item => 
      item.toLowerCase() === lowerArg || 
      item.toLowerCase().startsWith(lowerArg)
    );

    if (itemIndex !== -1) {
      const item = client.user.inventory.items[itemIndex];
      // Add to room
      room.objects.push(item);
      // Remove from inventory
      client.user.inventory.items.splice(itemIndex, 1);
      
      // Save the changes
      this.roomManager.updateRoom(room);
      this.userManager.updateUserInventory(client.user.username, client.user.inventory);
      
      writeToClient(client, colorize(`You drop the ${item}.\r\n`, 'green'));
    } else {
      writeToClient(client, colorize(`You don't have that item.\r\n`, 'red'));
    }
  }
}
