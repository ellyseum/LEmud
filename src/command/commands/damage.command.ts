import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';
import { getPlayerLogger } from '../../utils/logger';

// No need to import writeCommandPrompt as it's handled by the CommandHandler

export class DamageCommand implements Command {
  name = 'damage';
  description = 'Take damage (for testing)';

  constructor(private userManager: UserManager) {}

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;
    
    // Get player logger for this user
    const playerLogger = getPlayerLogger(client.user.username);
    
    // Parse the damage amount
    const amount = parseInt(args, 10) || 0;
    
    if (amount <= 0) {
      writeToClient(client, colorize('Please specify a positive amount of damage.\r\n', 'yellow'));
      playerLogger.info('Damage command: Invalid damage amount specified');
      return;
    }
    
    // Calculate new health, allowing it to go negative up to -10
    const oldHealth = client.user.health;
    const newHealth = Math.max(oldHealth - amount, -10);
    const actualDamage = oldHealth - newHealth;
    
    // Update the user's health
    client.user.health = newHealth;
    
    // Save the changes
    this.userManager.updateUserStats(client.user.username, { health: newHealth });
    
    // Log health change
    playerLogger.info(`Health changed from ${oldHealth} to ${newHealth} (damage: ${actualDamage})`);
    
    if (actualDamage > 0) {
      writeToClient(client, colorize(`You have taken ${actualDamage} damage!\r\n`, 'red'));
      
      // Check if player is knocked unconscious (0 or below but above -10)
      if (newHealth <= 0 && newHealth > -10 && !client.user.isUnconscious) {
        client.user.isUnconscious = true;
        this.userManager.updateUserStats(client.user.username, { isUnconscious: true });
        writeToClient(client, colorize(`You collapse to the ground unconscious! You are bleeding out and will die at -10 HP.\r\n`, 'red'));
        
        // Log unconscious state
        playerLogger.warn(`Player fell unconscious at ${newHealth} HP`);
      }
      // Check if player is fully dead (-10 HP)
      else if (newHealth <= -10) {
        writeToClient(client, colorize(`You have died! Your body will be transported to the starting area.\r\n`, 'red'));
        
        // Log death
        playerLogger.warn(`Player died at ${newHealth} HP`);
        
        // In a real implementation, this would trigger the respawn logic
        // But for this testing command, we'll just report the death
      }
    } else {
      writeToClient(client, colorize(`You avoided the damage!\r\n`, 'green'));
      playerLogger.info('Player avoided damage');
    }
    
    // Command prompt will be displayed by CommandHandler after this function returns
  }
}
