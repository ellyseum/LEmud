import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient, writeFormattedMessageToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';
import { getPlayerLogger } from '../../utils/logger';
import { EffectManager } from '../../effects/effectManager';
import { EffectType, EffectPayload } from '../../types/effects';
import { CombatSystem } from '../../combat/combatSystem';

export class PoisonCommand implements Command {
  name = 'poison';
  description = 'Cast a poison spell on a target';
  private effectManager: EffectManager;
  private combatSystem: CombatSystem;

  constructor(private userManager: UserManager) {
    this.effectManager = EffectManager.getInstance(userManager, null as any);
    this.combatSystem = CombatSystem.getInstance(userManager, null as any);
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    // Get player logger for this user
    const playerLogger = getPlayerLogger(client.user.username);

    // Check if the player has enough mana
    const spellManaCost = this.getSpellManaCost(EffectType.POISON);
    if (client.user.mana < spellManaCost) {
      writeToClient(client, colorize('You do not have enough mana to cast poison.\r\n', 'yellow'));
      playerLogger.info('Poison command: Not enough mana');
      return;
    }

    // Deduct mana cost
    client.user.mana -= spellManaCost;
    this.userManager.updateUserStats(client.user.username, { mana: client.user.mana });

    // Find the target
    const targetName = args.trim();
    const target = this.combatSystem.findCombatEntityByName(targetName, client.user.currentRoomId);
    if (!target) {
      writeToClient(client, colorize(`Target ${targetName} not found.\r\n`, 'yellow'));
      playerLogger.info(`Poison command: Target ${targetName} not found`);
      return;
    }

    // Apply the poison effect
    const effectPayload: EffectPayload = this.getSpellEffectPayload(EffectType.POISON);
    this.effectManager.addEffect(target.getName(), target.isUser(), {
      type: EffectType.POISON,
      name: 'Poison',
      description: 'A poison spell effect.',
      durationTicks: 5,
      tickInterval: 1,
      payload: effectPayload,
      targetId: target.getName(),
      isPlayerEffect: target.isUser(),
    });

    // Notify the player
    writeFormattedMessageToClient(
      client,
      colorize(`You cast poison on ${target.getName()}.\r\n`, 'green')
    );

    // Broadcast to others in the room
    const username = client.user.username;
    this.combatSystem.broadcastRoomCombatMessage(
      client.user.currentRoomId!,
      `${username} casts poison on ${target.getName()}.\r\n`,
      'green' as ColorType,
      client.user.username
    );

    // Log the poison action
    playerLogger.info(`Player cast poison on ${target.getName()}, mana cost: ${spellManaCost}`);
  }

  /**
   * Get the mana cost for a spell
   */
  private getSpellManaCost(spellType: EffectType): number {
    switch (spellType) {
      case EffectType.POISON:
        return 8;
      default:
        return 0;
    }
  }

  /**
   * Get the effect payload for a spell
   */
  private getSpellEffectPayload(spellType: EffectType): EffectPayload {
    switch (spellType) {
      case EffectType.POISON:
        return { damagePerTick: 10 };
      default:
        return {};
    }
  }
}
