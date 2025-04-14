import { ConnectedClient } from '../../types';
import { CombatEntity } from '../combatEntity.interface';

/**
 * Base interface for combat states
 */
export interface CombatState {
  /**
   * Handle an attack action
   */
  handleAttack(attacker: CombatEntity, target: CombatEntity): boolean;
  
  /**
   * Handle movement
   */
  handleMovement(entity: ConnectedClient): void;
  
  /**
   * Handle player disconnect
   */
  handleDisconnect(entity: ConnectedClient): void;
  
  /**
   * Get the name of this state
   */
  getName(): string;
}

/**
 * Active combat state - standard combat
 */
export class ActiveCombatState implements CombatState {
  constructor(
    private onAttackCallback: (attacker: CombatEntity, target: CombatEntity) => boolean,
    private onMovementCallback: (entity: ConnectedClient) => void,
    private onDisconnectCallback: (entity: ConnectedClient) => void
  ) {}
  
  handleAttack(attacker: CombatEntity, target: CombatEntity): boolean {
    return this.onAttackCallback(attacker, target);
  }
  
  handleMovement(entity: ConnectedClient): void {
    this.onMovementCallback(entity);
  }
  
  handleDisconnect(entity: ConnectedClient): void {
    this.onDisconnectCallback(entity);
  }
  
  getName(): string {
    return 'active';
  }
}

/**
 * Fleeing combat state - attempting to break combat
 */
export class FleeingCombatState implements CombatState {
  private fleeAttemptTime: number;
  
  constructor(
    private onAttackCallback: (attacker: CombatEntity, target: CombatEntity) => boolean,
    private onMovementCallback: (entity: ConnectedClient) => void,
    private onDisconnectCallback: (entity: ConnectedClient) => void
  ) {
    this.fleeAttemptTime = Date.now();
  }
  
  handleAttack(attacker: CombatEntity, target: CombatEntity): boolean {
    // While fleeing, attacks have a 50% reduced chance to hit
    const regularResult = this.onAttackCallback(attacker, target);
    
    // Time-based mechanic: the longer in fleeing state, the higher chance of breaking combat
    const fleeingForMs = Date.now() - this.fleeAttemptTime;
    const fleeingForSeconds = fleeingForMs / 1000;
    
    // Every 3 seconds increases chance by 10%, capped at 80%
    const fleeSuccessChance = Math.min(0.2 + (fleeingForSeconds / 3) * 0.1, 0.8);
    
    // If random roll is less than flee success chance, the attack misses
    return regularResult && Math.random() > fleeSuccessChance;
  }
  
  handleMovement(entity: ConnectedClient): void {
    // Movement while fleeing has a guaranteed chance to break combat
    this.onMovementCallback(entity);
  }
  
  handleDisconnect(entity: ConnectedClient): void {
    this.onDisconnectCallback(entity);
  }
  
  getName(): string {
    return 'fleeing';
  }
}

/**
 * Unconscious combat state - player is down but not dead
 */
export class UnconsciousCombatState implements CombatState {
  constructor(
    private onAttackCallback: (attacker: CombatEntity, target: CombatEntity) => boolean,
    private onMovementCallback: (entity: ConnectedClient) => void,
    private onDisconnectCallback: (entity: ConnectedClient) => void
  ) {}
  
  handleAttack(attacker: CombatEntity, target: CombatEntity): boolean {
    // Unconscious targets can't attack
    if (attacker === target) return false;
    
    // Attacks against unconscious targets have 100% chance to hit and do minimal damage
    return true;
  }
  
  handleMovement(entity: ConnectedClient): void {
    // Can't move while unconscious
    // No-op
  }
  
  handleDisconnect(entity: ConnectedClient): void {
    this.onDisconnectCallback(entity);
  }
  
  getName(): string {
    return 'unconscious';
  }
}