// filepath: /Users/jelden/projects/game/src/command/commands/giveitem.command.ts
import { ConnectedClient, GameItem } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { ItemManager } from '../../utils/itemManager';
import { UserManager } from '../../user/userManager';
import { SudoCommand } from './sudo.command';

export class GiveItemCommand implements Command {
  name = 'giveitem';
  description = 'Give an item to a player (Admin only)';
  private itemManager: ItemManager;
  private userManager: UserManager;

  constructor(userManager: UserManager) {
    this.itemManager = ItemManager.getInstance();
    this.userManager = userManager;
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    // Get the sudo command to check for admin privileges
    let sudoCommand: SudoCommand | undefined;
    
    // Try to get the sudo command from client's state data first
    if (client.stateData && client.stateData.commands) {
      sudoCommand = client.stateData.commands.get('sudo') as SudoCommand;
    }
    
    // If not found in state data, get the singleton instance
    if (!sudoCommand) {
      sudoCommand = SudoCommand.getInstance();
    }
    
    // Check if the user has admin privileges
    const hasAdminAccess = sudoCommand.isAuthorized(client.user.username);
    if (!hasAdminAccess) {
      writeToClient(client, colorize('You do not have permission to use this command.\r\n', 'red'));
      writeToClient(client, colorize('Hint: Use "sudo" to gain admin privileges if authorized.\r\n', 'yellow'));
      return;
    }

    const argParts = args.split(' ');
    
    // Format: giveitem <itemId> [username]
    // If username is omitted, give the item to the command user
    let itemId = argParts[0];
    let targetUsername = argParts.length > 1 ? argParts[1] : client.user.username;
    
    if (!itemId) {
      writeToClient(client, colorize('Usage: giveitem <itemId> [username]\r\n', 'yellow'));
      this.listAvailableItems(client);
      return;
    }

    // Get the item
    const item = this.itemManager.getItem(itemId);
    if (!item) {
      writeToClient(client, colorize(`Item with ID "${itemId}" not found.\r\n`, 'red'));
      this.listAvailableItems(client);
      return;
    }

    // Find the target user
    const targetUser = this.userManager.getUser(targetUsername);
    if (!targetUser) {
      writeToClient(client, colorize(`User "${targetUsername}" not found.\r\n`, 'red'));
      return;
    }

    // Add the item to the target user's inventory
    if (!targetUser.inventory) {
      targetUser.inventory = {
        items: [],
        currency: { gold: 0, silver: 0, copper: 0 }
      };
    }
    
    if (!targetUser.inventory.items) {
      targetUser.inventory.items = [];
    }
    
    targetUser.inventory.items.push(itemId);
    
    // Save the changes
    this.userManager.updateUserInventory(targetUsername, targetUser.inventory);
    
    // Notify the admin
    if (targetUsername === client.user.username) {
      writeToClient(client, colorize(`Added ${item.name} to your inventory.\r\n`, 'green'));
    } else {
      writeToClient(client, colorize(`Added ${item.name} to ${targetUsername}'s inventory.\r\n`, 'green'));
    }
    
    // Notify the target user if they're online and not the admin
    if (targetUsername !== client.user.username) {
      const targetClient = this.userManager.getActiveUserSession(targetUsername);
      if (targetClient) {
        writeToClient(targetClient, colorize(`${client.user.username} gave you ${item.name}.\r\n`, 'green'));
      }
    }
  }
  
  /**
   * List all available items that can be given
   */
  private listAvailableItems(client: ConnectedClient): void {
    const items = this.itemManager.getAllItems();
    
    if (items.length === 0) {
      writeToClient(client, colorize('No items available.\r\n', 'yellow'));
      return;
    }
    
    writeToClient(client, colorize('Available items:\r\n', 'cyan'));
    
    // Group items by type
    const itemsByType: { [type: string]: GameItem[] } = {};
    
    items.forEach(item => {
      if (!itemsByType[item.type]) {
        itemsByType[item.type] = [];
      }
      itemsByType[item.type].push(item);
    });
    
    // Print items by type
    Object.entries(itemsByType).forEach(([type, typeItems]) => {
      writeToClient(client, colorize(`\r\n[${type.toUpperCase()}]\r\n`, 'magenta'));
      
      typeItems.forEach(item => {
        writeToClient(client, colorize(`${item.id}: ${item.name} (${item.slot || 'no slot'})\r\n`, 'white'));
      });
    });
  }
}