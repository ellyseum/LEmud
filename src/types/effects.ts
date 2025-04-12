// filepath: /Users/jelden/projects/game/src/types/effects.ts

/**
 * Enum defining the different types of effects that can be applied to entities
 */
export enum EffectType {
  POISON = 'poison',
  REGEN = 'regen',
  STUN = 'stun',
  STRENGTH_BUFF = 'strength_buff',
  AGILITY_BUFF = 'agility_buff',
  DEFENSE_BUFF = 'defense_buff',
  ATTACK_BUFF = 'attack_buff',
  DAMAGE_OVER_TIME = 'damage_over_time',
  HEAL_OVER_TIME = 'heal_over_time',
  MOVEMENT_BLOCK = 'movement_block',
  // Add more effect types as needed
}

/**
 * Enum defining how effects of the same type interact with each other
 */
export enum StackingBehavior {
  REPLACE,        // New effect completely replaces old of same type
  REFRESH,        // New effect replaces old, resetting duration (with new payload)
  STACK_DURATION, // Add duration of new effect to old
  STACK_INTENSITY,// Both effects run independently
  STRONGEST_WINS, // Only the effect with the 'strongest' payload applies
  IGNORE,         // New effect is ignored if one of same type exists
}

/**
 * Interface defining the possible payload data for effects
 */
export interface EffectPayload {
  damagePerTick?: number;         // Damage dealt each tick
  healPerTick?: number;           // Healing applied each tick
  damageAmount?: number;          // Alternate name for time-based effects
  healAmount?: number;            // Alternate name for time-based effects
  statModifiers?: {               // Stat modifications
    [stat: string]: number;       // e.g., { agility: 5, strength: -2 }
  };
  blockMovement?: boolean;        // Whether movement is blocked
  blockCombat?: boolean;          // Whether combat is blocked
  // Add more payload options as needed
}

/**
 * Interface representing an active effect instance
 */
export interface ActiveEffect {
  id: string;                     // Unique instance ID (uuid)
  type: EffectType;               // Type of effect
  name: string;                   // User-friendly name
  description: string;            // Description of what the effect does
  durationTicks: number;          // Total duration in game ticks
  remainingTicks: number;         // Remaining ticks before expiry
  
  isTimeBased: boolean;           // True if triggers on real time instead of game ticks
  tickInterval: number;           // How often tick-based effects trigger (0 for passive)
  realTimeIntervalMs?: number;    // How often time-based effects trigger (ms)
  
  lastTickApplied: number;        // Game tick when last triggered
  lastRealTimeApplied?: number;   // Timestamp when last triggered (for time-based)
  
  payload: EffectPayload;         // Effect-specific data
  targetId: string;               // Username or NPC ID
  isPlayerEffect: boolean;        // Whether target is a player
  
  sourceId?: string;              // Who/what caused the effect (optional)
  stackingBehavior?: StackingBehavior; // How this effect stacks (overrides default)
}

/**
 * Mapping of effect types to their default stacking behavior
 */
export const effectStackingRules: { [key in EffectType]?: StackingBehavior } = {
  [EffectType.POISON]: StackingBehavior.REFRESH,
  [EffectType.REGEN]: StackingBehavior.REFRESH,
  [EffectType.STUN]: StackingBehavior.REFRESH,
  [EffectType.STRENGTH_BUFF]: StackingBehavior.REFRESH,
  [EffectType.AGILITY_BUFF]: StackingBehavior.REFRESH,
  [EffectType.DEFENSE_BUFF]: StackingBehavior.REFRESH,
  [EffectType.ATTACK_BUFF]: StackingBehavior.REFRESH,
  [EffectType.DAMAGE_OVER_TIME]: StackingBehavior.STACK_INTENSITY,
  [EffectType.HEAL_OVER_TIME]: StackingBehavior.STACK_INTENSITY,
  [EffectType.MOVEMENT_BLOCK]: StackingBehavior.REFRESH,
  // Default: REFRESH if not specified in this map
};