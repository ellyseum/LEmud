import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { CombatSystem } from '../../combat/combatSystem';

export class BreakCommand implements Command {
  name = 'break';
  description = 'Try to disengage from combat';

  constructor(private combatSystem: CombatSystem) {}

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    if (!this.combatSystem.isInCombat(client)) {
      writeToClient(client, colorize(`You are not in combat.\r\n`, 'yellow'));
      return;
    }
    
    this.combatSystem.breakCombat(client);
  }
}
