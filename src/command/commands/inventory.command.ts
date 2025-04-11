import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { formatUsername } from '../../utils/formatters';
import { ItemManager } from '../../utils/itemManager';

export class InventoryCommand implements Command {
  name = 'inventory';
  description = 'Show your inventory contents';
  aliases = ['inv', 'i'];
  private itemManager: ItemManager;
  
  constructor() {
    this.itemManager = ItemManager.getInstance();
  }

  execute(client: ConnectedClient, _args: string): void {
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

    writeToClient(client, colorize(`=== ${formatUsername(client.user.username)}'s Inventory ===\r\n`, 'cyan'));
    
    // Show currency
    const currency = client.user.inventory.currency;
    if (currency.gold > 0 || currency.silver > 0 || currency.copper > 0) {
      const currencyParts = [];
      if (currency.gold > 0) {
        currencyParts.push(`${currency.gold} gold piece${currency.gold === 1 ? '' : 's'}`);
      }
      if (currency.silver > 0) {
        currencyParts.push(`${currency.silver} silver piece${currency.silver === 1 ? '' : 's'}`);
      }
      if (currency.copper > 0) {
        currencyParts.push(`${currency.copper} copper piece${currency.copper === 1 ? '' : 's'}`);
      }
      
      let currencyText = currencyParts.join(', ');
      if (currencyParts.length > 1) {
        const lastPart = currencyParts.pop();
        currencyText = `${currencyParts.join(', ')}, and ${lastPart}`;
      }
      
      writeToClient(client, colorize(`Currency: ${currencyText}\r\n`, 'yellow'));
    } else {
      writeToClient(client, colorize(`Currency: None\r\n`, 'yellow'));
    }
    
    // Show items with names instead of IDs
    const items = client.user.inventory.items;
    if (items.length > 0) {
      const itemNames = items.map(itemId => {
        const item = this.itemManager.getItem(itemId);
        return item ? item.name : itemId; // Fallback to ID if item not found
      });
      writeToClient(client, colorize(`Items: ${itemNames.join(', ')}\r\n`, 'green'));
    } else {
      writeToClient(client, colorize(`Items: None\r\n`, 'green'));
    }
    
    writeToClient(client, colorize(`================================\r\n`, 'cyan'));
  }
}
