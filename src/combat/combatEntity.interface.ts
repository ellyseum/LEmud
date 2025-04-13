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
  
  // Basic combat methods
  isAlive(): boolean;
  takeDamage(amount: number): number; // Returns actual damage dealt
  getAttackDamage(): number;
  getAttackText(target: string): string;
  
  // Aggression tracking methods
  hasAggression(playerName: string): boolean;
  addAggression(playerName: string, damageDealt?: number): void;
  removeAggression(playerName: string): void;
  getAllAggressors(): string[];
  clearAllAggression(): void;
  
  // Entity type and identification methods
  isUser(): boolean;
  getName(): string;
}
