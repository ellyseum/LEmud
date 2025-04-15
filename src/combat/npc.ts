import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { CombatEntity } from './combatEntity.interface';
import { systemLogger } from '../utils/logger';

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
  deathMessages: string[];
}

export class NPC implements CombatEntity {
  // Static cache to store loaded NPC data
  private static npcDataCache: Map<string, NPCData> | null = null;
  // Timestamp when the cache was last updated
  private static cacheTimestamp: number = 0;
  // Cache expiration time in milliseconds (default: 5 minutes)
  private static readonly CACHE_EXPIRY_MS: number = 5 * 60 * 1000;

  public description: string;
  public attackTexts: string[];
  public deathMessages: string[];
  // Map to track which players this NPC has aggression towards and the damage they've dealt
  private aggressors: Map<string, number> = new Map();
  // Unique instance ID for this NPC
  public readonly instanceId: string;
  // Template ID (original ID from npcs.json)
  public readonly templateId: string;

  constructor(
    public name: string,
    public health: number,
    public maxHealth: number,
    public damage: [number, number] = [1, 3],
    public isHostile: boolean = false,
    public isPassive: boolean = false,
    public experienceValue: number = 50,
    description?: string,
    attackTexts?: string[],
    deathMessages?: string[],
    templateId?: string,
    instanceId?: string
  ) {
    this.description = description || `A ${name} standing here.`;
    this.attackTexts = attackTexts || [
      `swipes $TARGET$ with its claws`,
      `lunges at $TARGET$`,
      `hisses and attacks $TARGET$`
    ];
    this.deathMessages = deathMessages || [
      `collapses to the ground and dies`
    ];
    this.templateId = templateId || name.toLowerCase();
    this.instanceId = instanceId || uuidv4();
  }

  // Static method to load NPC data from JSON with caching
  static loadNPCData(): Map<string, NPCData> {
    const currentTime = Date.now();
    
    // Return cached data if available and not expired
    if (NPC.npcDataCache && 
        (currentTime - NPC.cacheTimestamp) < NPC.CACHE_EXPIRY_MS) {
      return NPC.npcDataCache;
    }
    
    // Otherwise load from file and cache the result
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
        // Use a single string parameter rather than two parameters to ensure proper formatting
        systemLogger.warn(`NPCs file not found: ${npcFilePath}`);
      }
    } catch (error) {
      systemLogger.error(`Error loading NPCs: ${error}`);
    }
    
    // Store in cache for future calls
    NPC.npcDataCache = npcMap;
    NPC.cacheTimestamp = currentTime;
    
    return npcMap;
  }

  // Add a method to clear the cache if needed (e.g., for reloading data)
  static clearNpcDataCache(): void {
    NPC.npcDataCache = null;
    NPC.cacheTimestamp = 0;
  }

  // Add a method to set cache expiry time if needed
  static setCacheExpiryTime(expiryTimeMs: number): void {
    // Prevent setting invalid values
    if (expiryTimeMs > 0) {
      Object.defineProperty(NPC, 'CACHE_EXPIRY_MS', {
        value: expiryTimeMs
      });
    }
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
      npcData.attackTexts,
      npcData.deathMessages,
      npcData.id
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

  getDeathMessage(): string {
    // Get a random death message from the array
    return this.deathMessages[Math.floor(Math.random() * this.deathMessages.length)];
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

  // Implement the isUser method from CombatEntity interface
  isUser(): boolean {
    // NPCs are never users
    return false;
  }

  // Implement the getName method from CombatEntity interface
  getName(): string {
    // Return the name of this NPC
    return this.name;
  }
}
