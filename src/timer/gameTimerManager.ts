import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { RoomManager } from '../room/roomManager';
import { UserManager } from '../user/userManager';
import { CombatSystem } from '../combat/combatSystem';

// Configuration interface for the game timer system
export interface GameTimerConfig {
  tickInterval: number; // Time between ticks in milliseconds
  saveInterval: number; // Number of ticks between data saves
}

// Default configuration
const DEFAULT_CONFIG: GameTimerConfig = {
  tickInterval: 6000, // 6 seconds per tick
  saveInterval: 10    // Save every 10 ticks (1 minute)
};

// Load config from file or use defaults
function loadGameTimerConfig(): GameTimerConfig {
  const configPath = path.join(__dirname, '..', '..', 'data', 'gametimer-config.json');
  
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(data);
      return {
        tickInterval: config.tickInterval || DEFAULT_CONFIG.tickInterval,
        saveInterval: config.saveInterval || DEFAULT_CONFIG.saveInterval
      };
    }
  } catch (error) {
    console.error('Error loading game timer configuration:', error);
  }
  
  // If file doesn't exist or there's an error, use defaults
  return DEFAULT_CONFIG;
}

// Save config to file
function saveGameTimerConfig(config: GameTimerConfig): void {
  const configPath = path.join(__dirname, '..', '..', 'data', 'gametimer-config.json');
  const dataDir = path.join(__dirname, '..', '..', 'data');
  
  try {
    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Error saving game timer configuration:', error);
  }
}

export class GameTimerManager extends EventEmitter {
  private static instance: GameTimerManager | null = null;
  private config: GameTimerConfig;
  private tickCount: number = 0;
  private intervalId: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private userManager: UserManager;
  private roomManager: RoomManager;
  private combatSystem: CombatSystem;
  
  private constructor(userManager: UserManager, roomManager: RoomManager) {
    super();
    console.log('Creating GameTimerManager instance');
    this.config = loadGameTimerConfig();
    this.userManager = userManager;
    this.roomManager = roomManager;
    this.combatSystem = new CombatSystem(userManager, roomManager);
  }
  
  /**
   * Get the singleton instance of GameTimerManager.
   * If it doesn't exist, it will be created with the provided userManager and roomManager.
   * If it already exists, it will update the references to userManager and roomManager if needed.
   */
  public static getInstance(userManager: UserManager, roomManager: RoomManager): GameTimerManager {
    if (!GameTimerManager.instance) {
      GameTimerManager.instance = new GameTimerManager(userManager, roomManager);
    } else {
      // Update references if they're different objects
      GameTimerManager.instance.userManager = userManager;
      GameTimerManager.instance.roomManager = roomManager;
    }
    return GameTimerManager.instance;
  }
  
  /**
   * Reset the singleton instance (primarily for testing purposes)
   */
  public static resetInstance(): void {
    if (GameTimerManager.instance && GameTimerManager.instance.running) {
      GameTimerManager.instance.stop();
    }
    GameTimerManager.instance = null;
  }
  
  /**
   * Get the current game timer configuration
   */
  public getConfig(): GameTimerConfig {
    return { ...this.config };
  }
  
  /**
   * Update the game timer configuration
   */
  public updateConfig(newConfig: Partial<GameTimerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    saveGameTimerConfig(this.config);
    
    // If running, restart with new config
    if (this.running) {
      this.stop();
      this.start();
    }
  }
  
  /**
   * Start the game timer system
   */
  public start(): void {
    if (this.running) return;
    
    this.running = true;
    this.intervalId = setInterval(() => this.tick(), this.config.tickInterval);
    console.log(`Game timer started: ${this.config.tickInterval}ms interval, saving every ${this.config.saveInterval} ticks`);
  }
  
  /**
   * Stop the game timer system
   */
  public stop(): void {
    if (!this.running || !this.intervalId) return;
    
    clearInterval(this.intervalId);
    this.intervalId = null;
    this.running = false;
    console.log('Game timer stopped');
  }
  
  /**
   * Check if the game timer system is currently running
   */
  public isRunning(): boolean {
    return this.running;
  }
  
  /**
   * Force a tick to occur immediately
   */
  public forceTick(): void {
    this.tick();
  }
  
  /**
   * Force a save to occur immediately
   */
  public forceSave(): void {
    this.saveData();
  }
  
  /**
   * The main tick function - processes one game tick
   */
  private tick(): void {
    this.tickCount++;
    console.log(`Game tick ${this.tickCount}`);
    
    // Process all combat rounds for players actively engaged in combat
    this.combatSystem.processCombatRound();
    
    // Process room-based combat for entities with aggression
    this.combatSystem.processRoomCombat();
    
    // Check if it's time to save
    if (this.tickCount % this.config.saveInterval === 0) {
      console.log('Saving all game data...');
      this.forceSave();
      console.log('Game data saved successfully');
    }
  }
  
  /**
   * Save all game data
   */
  private saveData(): void {
    console.log('Saving all game data...');
    
    try {
      // Save users
      this.userManager.forceSave();
      
      // Save rooms
      this.roomManager.forceSave();
      
      // Emit save event for other systems to hook into
      this.emit('save');
      
      console.log('Game data saved successfully');
    } catch (error) {
      console.error('Error saving game data:', error);
    }
  }
  
  /**
   * Get the current tick count
   */
  public getTickCount(): number {
    return this.tickCount;
  }
  
  /**
   * Reset the tick count to zero
   */
  public resetTickCount(): void {
    this.tickCount = 0;
  }
  
  /**
   * Get the combat system instance
   */
  public getCombatSystem(): CombatSystem {
    return this.combatSystem;
  }
}
