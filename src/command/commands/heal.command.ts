import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';

export class HealCommand implements Command {
  name = 'heal';
  description = 'Heal yourself by the specified amount';

  constructor(private userManager: UserManager) {}

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;
    
    // Parse the heal amount
    const amount = parseInt(args, 10) || 0;
    
    if (amount <= 0) {
      writeToClient(client, colorize('Please specify a positive amount to heal.\r\n', 'yellow'));
      return;
    }
    
    // Calculate new health, not exceeding max health
    const oldHealth = client.user.health;
    const newHealth = Math.min(oldHealth + amount, client.user.maxHealth);
    const actualHealing = newHealth - oldHealth;
    
    // Update the user's health
    client.user.health = newHealth;
    
    // Save the changes
    this.userManager.updateUserStats(client.user.username, { health: newHealth });
    
    if (actualHealing > 0) {
      writeToClient(client, colorize(`You have been healed for ${actualHealing} hitpoints.\r\n`, 'green'));
    } else {
      writeToClient(client, colorize(`You are already at full health.\r\n`, 'yellow'));
    }
    
    // Command prompt will be displayed by CommandHandler after this function returns
  }
}
