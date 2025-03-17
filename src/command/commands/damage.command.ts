import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';

export class DamageCommand implements Command {
  name = 'damage';
  description = 'Take damage (for testing)';

  constructor(private userManager: UserManager) {}

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;
    
    // Parse the damage amount
    const amount = parseInt(args, 10) || 0;
    
    if (amount <= 0) {
      writeToClient(client, colorize('Please specify a positive amount of damage.\r\n', 'yellow'));
      return;
    }
    
    // Calculate new health, not going below 0
    const oldHealth = client.user.health;
    const newHealth = Math.max(oldHealth - amount, 0);
    const actualDamage = oldHealth - newHealth;
    
    // Update the user's health
    client.user.health = newHealth;
    
    // Save the changes
    this.userManager.updateUserStats(client.user.username, { health: newHealth });
    
    if (actualDamage > 0) {
      writeToClient(client, colorize(`You have taken ${actualDamage} damage!\r\n`, 'red'));
      
      if (newHealth === 0) {
        writeToClient(client, colorize(`You have been defeated! Use "heal" to recover.\r\n`, 'red'));
      }
    } else {
      writeToClient(client, colorize(`You avoided the damage!\r\n`, 'green'));
    }
  }
}
