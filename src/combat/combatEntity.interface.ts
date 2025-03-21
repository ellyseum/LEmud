/**
 * Interface for any entity that can participate in combat
 */
export interface CombatEntity {
  name: string;
  health: number;
  maxHealth: number;
  damage: [number, number]; // [min, max] damage range
  isHostile: boolean;
  isPassive: boolean;
  experienceValue: number;
  
  isAlive(): boolean;
  takeDamage(amount: number): number; // Returns actual damage dealt
  getAttackDamage(): number;
  getAttackText(target: string): string;
}
