import fs from 'fs';
import path from 'path';
import { CombatEntity } from './combatEntity.interface';

// Interface for NPC data loaded from JSON
export interface NPCData {
  id: string;
  name: string;
  description: string;
  health: number;
  maxHealth: number;
  damage: [number, number];
  isHostile: boolean;
  isPassive: boolean;
  experienceValue: number;
  attackTexts: string[];
}

export class NPC implements CombatEntity {
  public description: string;
  public attackTexts: string[];
  // Map to track which players this NPC has aggression towards and the damage they've dealt
  private aggressors: Map<string, number> = new Map();

  constructor(
    public name: string,
    public health: number,
    public maxHealth: number,
    public damage: [number, number] = [1, 3],
    public isHostile: boolean = false,
    public isPassive: boolean = false,
    public experienceValue: number = 50,
    description?: string,
    attackTexts?: string[]
  ) {
    this.description = description || `A ${name} standing here.`;
    this.attackTexts = attackTexts || [
      `swipes ${name} with its claws`,
      `lunges at ${name}`,
      `hisses and attacks ${name}`
    ];
  }

  // Static method to load NPC data from JSON
  static loadNPCData(): Map<string, NPCData> {
    const npcMap = new Map<string, NPCData>();
    const npcFilePath = path.join(__dirname, '..', '..', 'data', 'npcs.json');
    
    try {
      if (fs.existsSync(npcFilePath)) {
        const data = fs.readFileSync(npcFilePath, 'utf8');
        const npcArray: NPCData[] = JSON.parse(data);
        
        npcArray.forEach(npc => {
          npcMap.set(npc.id, npc);
        });
      } else {
        console.error('NPCs file not found:', npcFilePath);
      }
    } catch (error) {
      console.error('Error loading NPCs:', error);
    }
    
    return npcMap;
  }
  
  // Factory method to create NPC from NPC data
  static fromNPCData(npcData: NPCData): NPC {
    return new NPC(
      npcData.name,
      npcData.health,
      npcData.maxHealth,
      npcData.damage,
      npcData.isHostile,
      npcData.isPassive,
      npcData.experienceValue,
      npcData.description,
      npcData.attackTexts
    );
  }

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
    // Replace placeholder with target name if applicable
    const attackText = this.attackTexts[Math.floor(Math.random() * this.attackTexts.length)];
    return attackText.replace('$TARGET$', target);
  }

  // Aggression tracking implementation
  hasAggression(playerName: string): boolean {
    return this.aggressors.has(playerName);
  }

  addAggression(playerName: string, damageDealt: number = 0): void {
    const currentDamage = this.aggressors.get(playerName) || 0;
    this.aggressors.set(playerName, currentDamage + damageDealt);
    // If this is a hostile NPC, it should immediately become hostile to anyone who attacks
    this.isHostile = true;
  }

  removeAggression(playerName: string): void {
    this.aggressors.delete(playerName);
  }

  getAllAggressors(): string[] {
    return Array.from(this.aggressors.keys());
  }

  clearAllAggression(): void {
    this.aggressors.clear();
  }
}
