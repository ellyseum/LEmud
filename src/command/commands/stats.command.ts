import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { formatUsername } from '../../utils/formatters';
import { ItemManager } from '../../utils/itemManager';
import { colorizeItemName } from '../../utils/itemNameColorizer';

export class StatsCommand implements Command {
  name = 'stats';
  description = 'Show your character stats';
  private itemManager: ItemManager;

  constructor() {
    this.itemManager = ItemManager.getInstance();
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    const user = client.user;
    
    // Calculate combat stats based on equipment
    const attackValue = this.itemManager.calculateAttack(user);
    const defenseValue = this.itemManager.calculateDefense(user);
    const statBonuses = this.itemManager.calculateStatBonuses(user);
    
    // Update the user's calculated stats
    user.attack = attackValue;
    user.defense = defenseValue;
    
    writeToClient(client, colorize('=== Your Character Stats ===\r\n', 'magenta'));
    writeToClient(client, colorize(`Username: ${formatUsername(user.username)}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Health: ${user.health}/${user.maxHealth}\r\n`, 'green'));
    writeToClient(client, colorize(`Level: ${user.level}\r\n`, 'yellow'));
    writeToClient(client, colorize(`Experience: ${user.experience}\r\n`, 'blue'));
    
    // Display combat stats
    writeToClient(client, colorize('\r\n=== Combat Stats ===\r\n', 'magenta'));
    writeToClient(client, colorize(`Attack: ${attackValue}\r\n`, 'red'));
    writeToClient(client, colorize(`Defense: ${defenseValue}\r\n`, 'blue'));
    
    // Display the character attributes/statistics with any bonuses from equipment
    writeToClient(client, colorize('\r\n=== Attributes ===\r\n', 'magenta'));
    writeToClient(client, colorize(`Strength: ${user.strength}${statBonuses.strength ? ` (+${statBonuses.strength})` : ''}\r\n`, 'white'));
    writeToClient(client, colorize(`Dexterity: ${user.dexterity}${statBonuses.dexterity ? ` (+${statBonuses.dexterity})` : ''}\r\n`, 'white'));
    writeToClient(client, colorize(`Agility: ${user.agility}${statBonuses.agility ? ` (+${statBonuses.agility})` : ''}\r\n`, 'white'));
    writeToClient(client, colorize(`Constitution: ${user.constitution}${statBonuses.constitution ? ` (+${statBonuses.constitution})` : ''}\r\n`, 'white'));
    writeToClient(client, colorize(`Wisdom: ${user.wisdom}${statBonuses.wisdom ? ` (+${statBonuses.wisdom})` : ''}\r\n`, 'white'));
    writeToClient(client, colorize(`Intelligence: ${user.intelligence}${statBonuses.intelligence ? ` (+${statBonuses.intelligence})` : ''}\r\n`, 'white'));
    writeToClient(client, colorize(`Charisma: ${user.charisma}${statBonuses.charisma ? ` (+${statBonuses.charisma})` : ''}\r\n`, 'white'));
    
    // Display equipment if any
    if (user.equipment && Object.keys(user.equipment).length > 0) {
      writeToClient(client, colorize('\r\n=== Equipment ===\r\n', 'magenta'));
      
      for (const [slot, itemId] of Object.entries(user.equipment)) {
        if (!itemId) continue;
        
        // Convert slot key to display name
        const slotDisplayName = slot.split('_').map(word => 
          word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');
        
        // Check if it's an item instance first
        const instance = this.itemManager.getItemInstance(itemId);
        
        if (instance) {
          // It's an item instance, get the template and check for custom name
          const template = this.itemManager.getItem(instance.templateId);
          
          if (template) {
            let displayName = template.name;
            
            // Use custom name if available
            if (instance.properties?.customName) {
              displayName = colorizeItemName(instance.properties.customName);
            }
            
            writeToClient(client, colorize(`${slotDisplayName}: ${displayName}\r\n`, 'cyan'));
          } else {
            writeToClient(client, colorize(`${slotDisplayName}: <unknown item>\r\n`, 'red'));
          }
        } else {
          // Try as a legacy item
          const item = this.itemManager.getItem(itemId);
          if (item) {
            writeToClient(client, colorize(`${slotDisplayName}: ${item.name}\r\n`, 'cyan'));
          } else {
            writeToClient(client, colorize(`${slotDisplayName}: <unknown item>\r\n`, 'red'));
          }
        }
      }
    }
    
    writeToClient(client, colorize('\r\n=== Account Info ===\r\n', 'magenta'));
    writeToClient(client, colorize(`Member since: ${user.joinDate.toLocaleDateString()}\r\n`, 'dim'));
    writeToClient(client, colorize(`Last login: ${user.lastLogin.toLocaleDateString()}\r\n`, 'dim'));
    writeToClient(client, colorize('===========================\r\n', 'magenta'));
  }
}
