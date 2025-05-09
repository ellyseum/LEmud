import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient, writeFormattedMessageToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';
import { getPlayerLogger } from '../../utils/logger';
import { EffectManager } from '../../effects/effectManager';
import { EffectType, EffectPayload } from '../../types/effects';
import { Combat } from '../../combat/combat';

export class FireballCommand implements Command {
  name = 'fireball';
  description = 'Cast a fireball spell on a target';
  private effectManager: EffectManager;

  constructor(private userManager: UserManager) {
    this.effectManager = EffectManager.getInstance(userManager, null as any);
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    // Get player logger for this user
    const playerLogger = getPlayerLogger(client.user.username);

    // Check if the player has enough mana
    const spellManaCost = this.getSpellManaCost(EffectType.FIREBALL);
    if (client.user.mana < spellManaCost) {
      writeToClient(client, colorize('You do not have enough mana to cast fireball.\r\n', 'yellow'));
      playerLogger.info('Fireball command: Not enough mana');
      return;
    }

    // Deduct mana cost
    client.user.mana -= spellManaCost;
    this.userManager.updateUserStats(client.user.username, { mana: client.user.mana });

    // Find the target
    const targetName = args.trim();
    const room = this.userManager.getUserRoom(client.user.username);
    if (!room) {
      writeToClient(client, colorize('You are not in a valid room to cast fireball.\r\n', 'yellow'));
      playerLogger.info('Fireball command: Invalid room');
      return;
    }

    const target = room.getNPC(targetName) || this.userManager.getUser(targetName);
    if (!target) {
      writeToClient(client, colorize(`No target found with the name ${targetName}.\r\n`, 'yellow'));
      playerLogger.info(`Fireball command: No target found with name ${targetName}`);
      return;
    }

    // Apply the fireball effect
    const effectPayload: EffectPayload = this.getSpellEffectPayload(EffectType.FIREBALL);
    this.effectManager.addEffect(target.getName(), target.isUser(), {
      type: EffectType.FIREBALL,
      name: 'Fireball',
      description: 'A fireball spell effect.',
      durationTicks: 1,
      tickInterval: 1,
      payload: effectPayload,
      targetId: target.getName(),
      isPlayerEffect: target.isUser(),
    });

    // Notify the player
    writeFormattedMessageToClient(
      client,
      colorize(`You cast fireball on ${target.getName()}.\r\n`, 'green')
    );

    // Log the fireball action
    playerLogger.info(`Player cast fireball on ${target.getName()}, mana cost: ${spellManaCost}`);

    // Start combat if not already in combat
    if (!client.user.inCombat) {
      const combat = new Combat(client, this.userManager, this.userManager.roomManager, this.userManager.combatSystem);
      combat.addTarget(target);
      combat.processRound();
    }
  }

  /**
   * Get the mana cost for a spell
   */
  private getSpellManaCost(spellType: EffectType): number {
    switch (spellType) {
      case EffectType.FIREBALL:
        return 10;
      default:
        return 0;
    }
  }

  /**
   * Get the effect payload for a spell
   */
  private getSpellEffectPayload(spellType: EffectType): EffectPayload {
    switch (spellType) {
      case EffectType.FIREBALL:
        return { damageAmount: 80 };
      default:
        return {};
    }
  }
}
