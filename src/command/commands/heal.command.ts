import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient, writeFormattedMessageToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';
import { getPlayerLogger } from '../../utils/logger';
import { EffectManager } from '../../effects/effectManager';
import { EffectType, EffectPayload } from '../../types/effects';

export class HealCommand implements Command {
  name = 'heal';
  description = 'Heal yourself by the specified amount';
  private effectManager: EffectManager;

  constructor(private userManager: UserManager) {
    this.effectManager = EffectManager.getInstance(userManager, null as any);
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    // Get player logger for this user
    const playerLogger = getPlayerLogger(client.user.username);

    // Check if the player has enough mana
    const spellManaCost = this.getSpellManaCost(EffectType.HEAL);
    if (client.user.mana < spellManaCost) {
      writeToClient(client, colorize('You do not have enough mana to cast heal.\r\n', 'yellow'));
      playerLogger.info('Heal command: Not enough mana');
      return;
    }

    // Deduct mana cost
    client.user.mana -= spellManaCost;
    this.userManager.updateUserStats(client.user.username, { mana: client.user.mana });

    // Apply the heal effect
    const effectPayload: EffectPayload = this.getSpellEffectPayload(EffectType.HEAL);
    this.effectManager.addEffect(client.user.username, true, {
      type: EffectType.HEAL,
      name: 'Heal',
      description: 'A healing spell effect.',
      durationTicks: 1,
      tickInterval: 1,
      payload: effectPayload,
      targetId: client.user.username,
      isPlayerEffect: true,
    });

    // Notify the player
    writeFormattedMessageToClient(
      client,
      colorize(`You cast heal on yourself.\r\n`, 'green')
    );

    // Log the heal action
    playerLogger.info(`Player cast heal on themselves, mana cost: ${spellManaCost}`);
  }

  /**
   * Get the mana cost for a spell
   */
  private getSpellManaCost(spellType: EffectType): number {
    switch (spellType) {
      case EffectType.HEAL:
        return 5;
      default:
        return 0;
    }
  }

  /**
   * Get the effect payload for a spell
   */
  private getSpellEffectPayload(spellType: EffectType): EffectPayload {
    switch (spellType) {
      case EffectType.HEAL:
        return { healAmount: Math.floor(Math.random() * 20) + 10 };
      default:
        return {};
    }
  }
}
