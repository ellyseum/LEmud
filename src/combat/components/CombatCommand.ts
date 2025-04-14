import { ConnectedClient } from '../../types';
import { CombatEntity } from '../combatEntity.interface';
import { UserManager } from '../../user/userManager';
import { CombatNotifier } from './CombatNotifier';
import { systemLogger, getPlayerLogger } from '../../utils/logger';

/**
 * Base interface for combat commands
 */
export interface CombatCommand {
  execute(): void;
}

/**
 * Command for an attack action
 */
export class AttackCommand implements CombatCommand {
  constructor(
    private attacker: CombatEntity,
    private target: CombatEntity,
    private notifier: CombatNotifier,
    private roomId: string,
    private userManager?: UserManager,
    private targetClient?: ConnectedClient
  ) {}
  
  execute(): void {
    // Calculate hit chance (50% base chance)
    const hit = Math.random() >= 0.5;
    
    if (hit) {
      const damage = this.attacker.getAttackDamage();
      
      // If target is a player (has a client), update their health
      if (this.targetClient?.user && this.userManager) {
        this.targetClient.user.health -= damage;
        
        // Make sure it doesn't go below -10
        if (this.targetClient.user.health < -10) {
          this.targetClient.user.health = -10;
        }
        
        // Update the player's health
        this.userManager.updateUserStats(
          this.targetClient.user.username, 
          { health: this.targetClient.user.health }
        );
      } else if (this.target.takeDamage) {
        // Target is an NPC or other entity with takeDamage method
        this.target.takeDamage(damage);
      }
      
      // Notify about the attack result
      if (this.targetClient) {
        this.notifier.notifyAttackResult(
          this.attacker,
          this.targetClient,
          this.roomId,
          true,
          damage
        );
      } else {
        // Generic notification for NPC targets
        this.notifier.broadcastRoomMessage(
          this.roomId,
          `${this.attacker.name} attacks ${this.target.name} for ${damage} damage!\r\n`,
          'red'
        );
      }
      
      // Log the attack
      systemLogger.debug(
        `${this.attacker.name} attacked ${this.target.name} for ${damage} damage`
      );
      
      return;
    }
    
    // Attack missed
    if (this.targetClient) {
      this.notifier.notifyAttackResult(
        this.attacker,
        this.targetClient,
        this.roomId,
        false
      );
    } else {
      // Generic notification for NPC targets
      this.notifier.broadcastRoomMessage(
        this.roomId,
        `${this.attacker.name} attacks ${this.target.name} and misses!\r\n`,
        'cyan'
      );
    }
    
    // Log the miss
    systemLogger.debug(
      `${this.attacker.name} attacked ${this.target.name} and missed`
    );
  }
}

/**
 * Command for a flee attempt
 */
export class FleeCommand implements CombatCommand {
  constructor(
    private player: ConnectedClient,
    private notifier: CombatNotifier
  ) {}
  
  execute(): void {
    if (!this.player.user) return;
    
    // Calculate flee chance (30% base chance)
    const fleeSuccess = Math.random() < 0.3;
    
    if (fleeSuccess) {
      // Set player's inCombat to false
      this.player.user.inCombat = false;
      
      // Notify player and room
      this.notifier.broadcastRoomMessage(
        this.player.user.currentRoomId || '',
        `${this.player.user.username} breaks away from combat!\r\n`,
        'green'
      );
      
      // Log the successful flee
      const playerLogger = getPlayerLogger(this.player.user.username);
      playerLogger.info(`Successfully fled from combat`);
    } else {
      // Notify player and room about failed flee attempt
      this.notifier.broadcastRoomMessage(
        this.player.user.currentRoomId || '',
        `${this.player.user.username} tries to flee but is still in combat!\r\n`,
        'yellow'
      );
      
      // Log the failed flee attempt
      const playerLogger = getPlayerLogger(this.player.user.username);
      playerLogger.info(`Failed to flee from combat`);
    }
  }
}

/**
 * Command factory to create appropriate commands
 */
export class CombatCommandFactory {
  constructor(
    private notifier: CombatNotifier,
    private userManager: UserManager
  ) {}
  
  createAttackCommand(
    attacker: CombatEntity,
    target: CombatEntity,
    roomId: string,
    targetClient?: ConnectedClient
  ): CombatCommand {
    return new AttackCommand(
      attacker,
      target,
      this.notifier,
      roomId,
      this.userManager,
      targetClient
    );
  }
  
  createFleeCommand(player: ConnectedClient): CombatCommand {
    return new FleeCommand(player, this.notifier);
  }
}