import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';
import { getPlayerLogger } from '../../utils/logger';

export class HealCommand implements Command {
  name = 'heal';
  description = 'Heal yourself by the specified amount';

  constructor(private userManager: UserManager) {}

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;
    
    // Get player logger for this user
    const playerLogger = getPlayerLogger(client.user.username);
    
    // Parse the heal amount
    const amount = parseInt(args, 10) || 0;
    
    if (amount <= 0) {
      writeToClient(client, colorize('Please specify a positive amount to heal.\r\n', 'yellow'));
      playerLogger.info('Heal command: Invalid heal amount specified');
      return;
    }
    
    // Calculate new health, not exceeding max health
    const oldHealth = client.user.health;
    const newHealth = Math.min(oldHealth + amount, client.user.maxHealth);
    const actualHealing = newHealth - oldHealth;
    
    // Update the user's health
    client.user.health = newHealth;
    
    // Log health change
    playerLogger.info(`Health changed from ${oldHealth} to ${newHealth} (healed: ${actualHealing})`);
    
    // Check if player was unconscious and is now conscious
    const wasUnconscious = client.user.isUnconscious && oldHealth <= 0;
    
    // If player was unconscious and is now above 0 HP, they regain consciousness
    if (wasUnconscious && newHealth > 0) {
      client.user.isUnconscious = false;
      this.userManager.updateUserStats(client.user.username, { 
        health: newHealth,
        isUnconscious: false
      });
      
      // Log regaining consciousness
      playerLogger.info(`Player regained consciousness at ${newHealth} HP`);
      
      writeToClient(client, colorize(`You have been healed for ${actualHealing} hitpoints and regained consciousness!\r\n`, 'green'));
    } else {
      // Just update health normally
      this.userManager.updateUserStats(client.user.username, { health: newHealth });
      
      if (actualHealing > 0) {
        writeToClient(client, colorize(`You have been healed for ${actualHealing} hitpoints.\r\n`, 'green'));
      } else {
        writeToClient(client, colorize(`You are already at full health.\r\n`, 'yellow'));
        playerLogger.info('Heal command: Player already at full health');
      }
    }
    
    // Command prompt will be displayed by CommandHandler after this function returns
  }
}
