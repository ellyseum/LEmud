// filepath: /Users/jelden/projects/game/src/utils/itemManager.ts
import fs from 'fs';
import path from 'path';
import { GameItem, User, EquipmentSlot } from '../types';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');

export class ItemManager {
  private static instance: ItemManager | null = null;
  private items: Map<string, GameItem> = new Map();

  public static getInstance(): ItemManager {
    if (!ItemManager.instance) {
      ItemManager.instance = new ItemManager();
    }
    return ItemManager.instance;
  }

  constructor() {
    this.loadItems();
  }

  private loadItems(): void {
    try {
      // Create data directory if it doesn't exist
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      // Create items file if it doesn't exist
      if (!fs.existsSync(ITEMS_FILE)) {
        // Initialize with some default items
        const defaultItems: GameItem[] = [
          // Weapons
          {
            id: 'sword-001',
            name: 'Iron Sword',
            description: 'A sturdy iron sword with a sharp edge.',
            type: 'weapon',
            slot: EquipmentSlot.MAIN_HAND,
            value: 50,
            weight: 5,
            stats: {
              attack: 5,
              strength: 2
            },
            requirements: {
              level: 1,
              strength: 5
            }
          },
          {
            id: 'shield-001',
            name: 'Wooden Shield',
            description: 'A basic wooden shield that provides some protection.',
            type: 'armor',
            slot: EquipmentSlot.OFF_HAND,
            value: 30,
            weight: 4,
            stats: {
              defense: 3,
              constitution: 1
            }
          },
          
          // Head slot
          {
            id: 'helmet-001',
            name: 'Leather Cap',
            description: 'A simple leather cap that offers minimal protection.',
            type: 'armor',
            slot: EquipmentSlot.HEAD,
            value: 25,
            weight: 2,
            stats: {
              defense: 2
            }
          },
          
          // Neck slot
          {
            id: 'amulet-001',
            name: 'Copper Amulet',
            description: 'A simple amulet made of copper.',
            type: 'armor',
            slot: EquipmentSlot.NECK,
            value: 35,
            weight: 1,
            stats: {
              wisdom: 1,
              intelligence: 1
            }
          },
          
          // Chest slot
          {
            id: 'chest-001',
            name: 'Padded Tunic',
            description: 'A padded tunic that offers some protection.',
            type: 'armor',
            slot: EquipmentSlot.CHEST,
            value: 45,
            weight: 6,
            stats: {
              defense: 4,
              constitution: 1
            }
          },
          
          // Back slot
          {
            id: 'cloak-001',
            name: 'Traveler\'s Cloak',
            description: 'A warm cloak that keeps you dry in the rain.',
            type: 'armor',
            slot: EquipmentSlot.BACK,
            value: 20,
            weight: 3,
            stats: {
              defense: 1,
              constitution: 1
            }
          },
          
          // Arms slot
          {
            id: 'arms-001',
            name: 'Leather Bracers',
            description: 'Protective bracers made of hardened leather.',
            type: 'armor',
            slot: EquipmentSlot.ARMS,
            value: 30,
            weight: 2,
            stats: {
              defense: 2,
              dexterity: 1
            }
          },
          
          // Hands slot
          {
            id: 'gloves-001',
            name: 'Leather Gloves',
            description: 'Simple gloves that protect your hands.',
            type: 'armor',
            slot: EquipmentSlot.HANDS,
            value: 15,
            weight: 1,
            stats: {
              defense: 1,
              dexterity: 1
            }
          },
          
          // Finger slot
          {
            id: 'ring-001',
            name: 'Silver Ring',
            description: 'A simple silver ring.',
            type: 'armor',
            slot: EquipmentSlot.FINGER,
            value: 50,
            weight: 0.1,
            stats: {
              intelligence: 2
            }
          },
          
          // Waist slot
          {
            id: 'belt-001',
            name: 'Leather Belt',
            description: 'A sturdy leather belt with a brass buckle.',
            type: 'armor',
            slot: EquipmentSlot.WAIST,
            value: 25,
            weight: 1,
            stats: {
              defense: 1,
              strength: 1
            }
          },
          
          // Legs slot
          {
            id: 'legs-001',
            name: 'Leather Leggings',
            description: 'Protective leggings made of leather.',
            type: 'armor',
            slot: EquipmentSlot.LEGS,
            value: 35,
            weight: 3,
            stats: {
              defense: 3,
              agility: 1
            }
          },
          
          // Feet slot
          {
            id: 'boots-001',
            name: 'Leather Boots',
            description: 'Sturdy boots for long travels.',
            type: 'armor',
            slot: EquipmentSlot.FEET,
            value: 30,
            weight: 2,
            stats: {
              defense: 2,
              agility: 1
            }
          }
        ];
        
        fs.writeFileSync(ITEMS_FILE, JSON.stringify(defaultItems, null, 2));
        
        // Load the default items into memory
        defaultItems.forEach(item => {
          this.items.set(item.id, item);
        });
        
        return;
      }

      // Load items from file
      const data = fs.readFileSync(ITEMS_FILE, 'utf8');
      const itemArray: GameItem[] = JSON.parse(data);
      
      // Store items in memory map for fast lookups
      itemArray.forEach(item => {
        this.items.set(item.id, item);
      });
      
    } catch (error) {
      console.error('Error loading items:', error);
      this.items = new Map();
    }
  }

  public saveItems(): void {
    try {
      const itemArray = Array.from(this.items.values());
      fs.writeFileSync(ITEMS_FILE, JSON.stringify(itemArray, null, 2));
    } catch (error) {
      console.error('Error saving items:', error);
    }
  }

  public getItem(itemId: string): GameItem | undefined {
    return this.items.get(itemId);
  }

  public getAllItems(): GameItem[] {
    return Array.from(this.items.values());
  }

  public addItem(item: GameItem): void {
    this.items.set(item.id, item);
    this.saveItems();
  }

  public updateItem(item: GameItem): boolean {
    if (!this.items.has(item.id)) {
      return false;
    }
    
    this.items.set(item.id, item);
    this.saveItems();
    return true;
  }

  public deleteItem(itemId: string): boolean {
    const deleted = this.items.delete(itemId);
    if (deleted) {
      this.saveItems();
    }
    return deleted;
  }

  /**
   * Calculate a user's attack value based on their equipment
   */
  public calculateAttack(user: User): number {
    // Base attack value (could be derived from strength or other stats)
    let attack = Math.floor(user.strength / 2);
    
    // Add bonuses from equipped items
    if (user.equipment) {
      Object.values(user.equipment).forEach(itemId => {
        const item = this.getItem(itemId);
        if (item?.stats?.attack) {
          attack += item.stats.attack;
        }
      });
    }
    
    return attack;
  }

  /**
   * Calculate a user's defense value based on their equipment
   */
  public calculateDefense(user: User): number {
    // Base defense value (could be derived from constitution or other stats)
    let defense = Math.floor(user.constitution / 2);
    
    // Add bonuses from equipped items
    if (user.equipment) {
      Object.values(user.equipment).forEach(itemId => {
        const item = this.getItem(itemId);
        if (item?.stats?.defense) {
          defense += item.stats.defense;
        }
      });
    }
    
    return defense;
  }

  /**
   * Calculate all stat bonuses from a user's equipment
   * Returns an object with the bonuses for each stat
   */
  public calculateStatBonuses(user: User): { [stat: string]: number } {
    const bonuses: { [stat: string]: number } = {
      strength: 0,
      dexterity: 0,
      agility: 0,
      constitution: 0,
      wisdom: 0,
      intelligence: 0,
      charisma: 0
    };
    
    // Add bonuses from equipped items
    if (user.equipment) {
      Object.values(user.equipment).forEach(itemId => {
        const item = this.getItem(itemId);
        if (item?.stats) {
          // Add each stat bonus
          if (item.stats.strength) bonuses.strength += item.stats.strength;
          if (item.stats.dexterity) bonuses.dexterity += item.stats.dexterity;
          if (item.stats.agility) bonuses.agility += item.stats.agility;
          if (item.stats.constitution) bonuses.constitution += item.stats.constitution;
          if (item.stats.wisdom) bonuses.wisdom += item.stats.wisdom;
          if (item.stats.intelligence) bonuses.intelligence += item.stats.intelligence;
          if (item.stats.charisma) bonuses.charisma += item.stats.charisma;
        }
      });
    }
    
    return bonuses;
  }

  /**
   * Get all items the user currently has equipped
   */
  public getEquippedItems(user: User): Map<string, GameItem> {
    const equippedItems = new Map<string, GameItem>();
    
    if (user.equipment) {
      Object.entries(user.equipment).forEach(([slot, itemId]) => {
        const item = this.getItem(itemId);
        if (item) {
          equippedItems.set(slot, item);
        }
      });
    }
    
    return equippedItems;
  }
}