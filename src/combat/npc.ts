import { CombatEntity } from './combatEntity.interface';

export class NPC implements CombatEntity {
  constructor(
    public name: string,
    public health: number,
    public maxHealth: number,
    public damage: [number, number] = [1, 3],
    public isHostile: boolean = false,
    public isPassive: boolean = false,
    public experienceValue: number = 50
  ) {}

  isAlive(): boolean {
    return this.health > 0;
  }

  takeDamage(amount: number): number {
    const actualDamage = Math.min(this.health, amount);
    this.health -= actualDamage;
    return actualDamage;
  }

  getAttackDamage(): number {
    const [min, max] = this.damage;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  getAttackText(target: string): string {
    const attackText = [
      `swipes ${target} with its claws`,
      `lunges at ${target}`,
      `hisses and attacks ${target}`
    ];
    return attackText[Math.floor(Math.random() * attackText.length)];
  }
}
