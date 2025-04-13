import { Command } from '../command.interface';
import { ConnectedClient } from '../../types';
import { writeToClient } from '../../utils/socketWriter';
import { colorize } from '../../utils/colors';
import { CombatSystem } from '../../combat/combatSystem';
import { UserManager } from '../../user/userManager';
import { getPlayerLogger } from '../../utils/logger';
import { CombatEntity } from '../../combat/combatEntity.interface';

export class BreakCommand implements Command {
  name = 'break';
  description = 'Attempt to break away from combat';

  constructor(
    private combatSystem: CombatSystem,
    private userManager: UserManager
  ) {}

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;
    
    // Get player-specific logger
    const playerLogger = getPlayerLogger(client.user.username);

    if (!client.user.inCombat) {
      writeToClient(client, colorize('You are not in combat.\r\n', 'yellow'));
      return;
    }

    // Get the opponents of the player
    const opponents = this.combatSystem.getOpponents(client.user.username);
    if (!opponents || opponents.length === 0) {
      writeToClient(client, colorize('You have no opponents to break away from.\r\n', 'yellow'));
      playerLogger.info(`Player ${client.user.username} tried to break from combat but had no opponents`);
      return;
    }

    // 50% chance to break combat
    const success = Math.random() >= 0.5;
    if (success) {
      // Iterate through opponents and remove the player from their target lists
      opponents.forEach((opponent: CombatEntity) => {
        // Fix accessing instanceId which doesn't exist on CombatEntity
        // Use only the name property which is more likely to exist on all CombatEntity instances
        const opponentId = opponent.name;
        
        // Add null check for client.user
        if (client.user) {
          playerLogger.info(`Player ${client.user.username} successfully broke away from ${opponent.name} (${opponentId})`);
        } else {
          playerLogger.info(`Player successfully broke away from ${opponent.name} (${opponentId})`);
        }
      });

      this.combatSystem.breakCombat(client);
      writeToClient(client, colorize('You break away from combat!\r\n', 'green'));
      playerLogger.info(`Player ${client.user.username} successfully broke away from combat`);
    } else {
      writeToClient(client, colorize('You failed to break away from combat!\r\n', 'red'));
      playerLogger.info(`Player ${client.user.username} failed to break away from combat`);
    }
  }
}
