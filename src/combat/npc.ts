import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { CombatEntity } from './combatEntity.interface';
import { systemLogger } from '../utils/logger';
import { parseAndValidateJson } from '../utils/jsonUtils';
import { loadAndValidateJsonFile } from '../utils/fileUtils';
import config from '../config';

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

  /**
   * Load pre-validated NPC data
   * @param npcData Array of validated NPC data objects
   * @returns Map of NPC data indexed by ID
   */
  static loadPrevalidatedNPCData(npcData: NPCData[]): Map<string, NPCData> {
    const npcMap = new Map<string, NPCData>();
    
    npcData.forEach(npc => {
      npcMap.set(npc.id, npc);
    });
    
    // Update the cache
    NPC.npcDataCache = npcMap;
    NPC.cacheTimestamp = Date.now();
    
    systemLogger.info(`Loaded ${npcMap.size} pre-validated NPCs`);
    return npcMap;
  }

  // Static method to load NPC data from JSON with caching
  static loadNPCData(): Map<string, NPCData> {
    const currentTime = Date.now();
    
    // Return cached data if available and not expired
    if (NPC.npcDataCache && 
        (currentTime - NPC.cacheTimestamp) < NPC.CACHE_EXPIRY_MS) {
      return NPC.npcDataCache;
    }
    
    // Try to load NPCs from command line argument if provided
    if (config.DIRECT_NPCS_DATA) {
      try {
        const npcArray = parseAndValidateJson<NPCData[]>(config.DIRECT_NPCS_DATA, 'npcs');
        if (npcArray && Array.isArray(npcArray)) {
          return NPC.loadPrevalidatedNPCData(npcArray);
        }
      } catch (error) {
        systemLogger.error('Failed to load NPCs from command line:', error);
        // Don't fall back to file loading, propagate the error
        throw error;
      }
    }
    
    // Otherwise load from file with validation
    return NPC.loadNPCDataFromFile();
  }
  
  /**
   * Load NPC data from file with validation
   */
  static loadNPCDataFromFile(): Map<string, NPCData> {
    const npcFilePath = path.join(__dirname, '..', '..', 'data', 'npcs.json');
    
    // Check if file exists
    if (!fs.existsSync(npcFilePath)) {
      systemLogger.warn(`NPCs file not found: ${npcFilePath}`);
      return new Map<string, NPCData>(); // Return empty map only if file doesn't exist
    }
    
    // Validate the file
    const npcArray = loadAndValidateJsonFile<NPCData[]>(npcFilePath, 'npcs');
    
    if (npcArray && Array.isArray(npcArray)) {
      return NPC.loadPrevalidatedNPCData(npcArray);
    } else {
      process.exit(1); // Exit if the file is not valid
    }
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
