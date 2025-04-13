// filepath: /Users/jelden/projects/game/src/utils/itemManager.ts
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { GameItem, User, EquipmentSlot, ItemTemplate, ItemInstance } from '../types';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const ITEM_INSTANCES_FILE = path.join(DATA_DIR, 'itemInstances.json');

export class ItemManager {
  private static instance: ItemManager | null = null;
  private items: Map<string, GameItem> = new Map();
  private itemInstances: Map<string, ItemInstance> = new Map();

  public static getInstance(): ItemManager {
    if (!ItemManager.instance) {
      ItemManager.instance = new ItemManager();
    }
    return ItemManager.instance;
  }

  private constructor() {
    this.loadItems();
    this.loadItemInstances();
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

  /**
   * Load saved item instances from disk
   */
  private loadItemInstances(): void {
    try {
      if (!fs.existsSync(ITEM_INSTANCES_FILE)) {
        // No instances file yet, will be created when saving
        return;
      }

      const data = fs.readFileSync(ITEM_INSTANCES_FILE, 'utf8');
      const instances: ItemInstance[] = JSON.parse(data);
      
      // Store instances in memory map and convert string dates to Date objects
      instances.forEach(instance => {
        // Convert string dates back to Date objects
        instance.created = new Date(instance.created);
        if (instance.history) {
          instance.history.forEach(entry => {
            entry.timestamp = new Date(entry.timestamp);
          });
        }
        
        this.itemInstances.set(instance.instanceId, instance);
      });
      
      console.log(`[ItemManager] Loaded ${instances.length} item instances.`);
    } catch (error) {
      console.error('Error loading item instances:', error);
      this.itemInstances = new Map();
    }
  }

  /**
   * Save all item instances to disk
   */
  public saveItemInstances(): void {
    try {
      const instances = Array.from(this.itemInstances.values());
      fs.writeFileSync(ITEM_INSTANCES_FILE, JSON.stringify(instances, null, 2));
      console.log(`[ItemManager] Saved ${instances.length} item instances.`);
    } catch (error) {
      console.error('Error saving item instances:', error);
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
   * Create a new item instance with optional properties like durability and quality
   */
  public createItemInstance(
    templateId: string, 
    createdBy: string = 'system', 
    properties?: Partial<ItemInstance['properties']>
  ): ItemInstance | null {
    // Check if template exists
    const template = this.getItem(templateId);
    if (!template) {
      console.error(`[ItemManager] Cannot create instance: Template ${templateId} not found.`);
      return null;
    }

    // Generate a unique instance ID
    const instanceId = uuidv4();
    
    // Set up default properties based on item type
    const defaultProperties: ItemInstance['properties'] = {};
    
    // Add durability for weapons and armor
    if (template.type === 'weapon' || template.type === 'armor') {
      defaultProperties.durability = {
        current: 100,
        max: 100
      };
    }
    
    // Set default quality to common
    defaultProperties.quality = 'common';
    
    // Create the item instance
    const instance: ItemInstance = {
      instanceId,
      templateId,
      created: new Date(),
      createdBy,
      properties: { ...defaultProperties, ...properties },
      history: [{
        timestamp: new Date(),
        event: 'created',
        details: `Created by ${createdBy}`
      }]
    };

    // Store the instance
    this.itemInstances.set(instanceId, instance);
    console.log(`[ItemManager] Created item instance ${instanceId} of ${templateId}`);
    
    // Save to disk
    this.saveItemInstances();
    
    return instance;
  }

  /**
   * Get an item instance by ID
   * Now supports using partial IDs (first 8 characters)
   * @returns The item instance, null if not found, or undefined if ambiguous
   */
  public getItemInstance(instanceId: string): ItemInstance | null | undefined {
    // First try direct lookup (most efficient)
    const directMatch = this.itemInstances.get(instanceId);
    if (directMatch) {
      return directMatch;
    }
    
    // If not found and at least 8 characters long, try partial match
    if (instanceId.length >= 8) {
      return this.findInstanceByPartialId(instanceId);
    }
    
    return null;
  }

  /**
   * Get a template for an item instance
   */
  public getTemplateForInstance(instanceId: string): GameItem | null {
    const instance = this.getItemInstance(instanceId);
    if (!instance) return null;
    
    return this.getItem(instance.templateId) || null;
  }

  /**
   * Add an event to an item's history
   */
  public addItemHistory(instanceId: string, event: string, details?: string): boolean {
    const instance = this.itemInstances.get(instanceId);
    if (!instance) {
      console.error(`[ItemManager] Cannot add history: Instance ${instanceId} not found.`);
      return false;
    }
    
    if (!instance.history) {
      instance.history = [];
    }
    
    instance.history.push({
      timestamp: new Date(),
      event,
      details
    });
    
    // Save changes
    this.saveItemInstances();
    return true;
  }

  /**
   * Find all instances of a specific template
   */
  public findInstancesByTemplate(templateId: string): ItemInstance[] {
    const instances: ItemInstance[] = [];
    for (const instance of this.itemInstances.values()) {
      if (instance.templateId === templateId) {
        instances.push(instance);
      }
    }
    return instances;
  }

  /**
   * Get the display name of an item instance, including quality and custom name if available
   */
  public getItemDisplayName(instanceId: string): string {
    const instance = this.getItemInstance(instanceId);
    if (!instance) return "unknown item";
    
    const template = this.getItem(instance.templateId);
    if (!template) return "unknown item";
    
    let name = "";
    
    // Add quality prefix if available
    if (instance.properties?.quality && instance.properties.quality !== 'common') {
      const qualityPrefix = this.getQualityPrefix(instance.properties.quality);
      name += qualityPrefix + " ";
    }
    
    // Use custom name if available, otherwise use template name
    name += instance.properties?.customName || template.name;
    
    return name;
  }

  /**
   * Get the full description of an item instance, including template description and instance-specific details
   */
  public getItemDescription(instanceId: string): string {
    const instance = this.getItemInstance(instanceId);
    if (!instance) return "You see nothing special.";
    
    const template = this.getItem(instance.templateId);
    if (!template) return "You see nothing special.";
    
    let description = template.description;
    
    // Add durability information if available
    if (instance.properties?.durability) {
      const durability = instance.properties.durability;
      const percentage = Math.floor((durability.current / durability.max) * 100);
      let condition = "";
      
      if (percentage > 90) condition = "in excellent condition";
      else if (percentage > 75) condition = "in good condition";
      else if (percentage > 50) condition = "showing signs of wear";
      else if (percentage > 25) condition = "badly worn";
      else if (percentage > 10) condition = "severely damaged";
      else condition = "about to break";
      
      description += `\nIt appears to be ${condition}.`;
    }
    
    // Add enchantment information if available
    if (instance.properties?.enchantments && instance.properties.enchantments.length > 0) {
      description += "\nIt gives off a magical aura.";
      
      instance.properties.enchantments.forEach(enchant => {
        description += `\nIt has been enchanted with ${enchant.name}: ${enchant.effect}`;
      });
    }
    
    // Add soulbound information if applicable
    if (instance.properties?.soulbound && instance.properties.boundTo) {
      description += `\nThis item is soulbound to ${instance.properties.boundTo}.`;
    }
    
    return description;
  }
  
  /**
   * Get color prefix for an item quality
   */
  private getQualityPrefix(quality: string): string {
    switch (quality) {
      case 'poor': return 'Damaged';
      case 'common': return '';
      case 'uncommon': return 'Fine';
      case 'rare': return 'Exceptional';
      case 'epic': return 'Magnificent';
      case 'legendary': return 'Legendary';
      default: return '';
    }
  }
  
  /**
   * Update durability of an item, returns true if item is still intact, false if it broke
   */
  public updateDurability(instanceId: string, change: number): boolean {
    const instance = this.getItemInstance(instanceId);
    if (!instance || !instance.properties?.durability) return true;
    
    // Apply durability change
    instance.properties.durability.current += change;
    
    // Make sure we don't exceed max durability
    if (instance.properties.durability.current > instance.properties.durability.max) {
      instance.properties.durability.current = instance.properties.durability.max;
    }
    
    // Check if item broke
    if (instance.properties.durability.current <= 0) {
      // Item is broken
      instance.properties.durability.current = 0;
      
      // Add to history
      this.addItemHistory(instanceId, 'broke', 'The item has broken from wear and tear');
      
      // Save changes
      this.saveItemInstances();
      return false;
    }
    
    // Item is still intact
    this.saveItemInstances();
    return true;
  }
  
  /**
   * Repair an item to restore its durability
   */
  public repairItem(instanceId: string, amount: number): boolean {
    const instance = this.getItemInstance(instanceId);
    if (!instance || !instance.properties?.durability) return false;
    
    // Apply repair amount
    instance.properties.durability.current += amount;
    
    // Cap at maximum durability
    if (instance.properties.durability.current > instance.properties.durability.max) {
      instance.properties.durability.current = instance.properties.durability.max;
    }
    
    // Add to history
    this.addItemHistory(instanceId, 'repaired', `Durability restored by ${amount} points`);
    
    // Save changes
    this.saveItemInstances();
    return true;
  }
  
  /**
   * Rename an item with a custom name
   */
  public renameItem(instanceId: string, newName: string, renamedBy: string): boolean {
    const instance = this.getItemInstance(instanceId);
    if (!instance) return false;
    
    // Initialize properties if needed
    if (!instance.properties) {
      instance.properties = {};
    }
    
    // Set the custom name
    instance.properties.customName = newName;
    
    // Add to history
    this.addItemHistory(
      instanceId, 
      'renamed', 
      `Renamed to "${newName}" by ${renamedBy}`
    );
    
    // Save changes
    this.saveItemInstances();
    return true;
  }
  
  /**
   * Add an enchantment to an item
   */
  public addEnchantment(
    instanceId: string, 
    enchantName: string, 
    effect: string, 
    bonuses?: {[stat: string]: number}
  ): boolean {
    const instance = this.getItemInstance(instanceId);
    if (!instance) return false;
    
    // Initialize properties if needed
    if (!instance.properties) {
      instance.properties = {};
    }
    
    // Initialize enchantments array if needed
    if (!instance.properties.enchantments) {
      instance.properties.enchantments = [];
    }
    
    // Add the enchantment
    instance.properties.enchantments.push({
      name: enchantName,
      effect,
      bonuses
    });
    
    // Add to history
    this.addItemHistory(
      instanceId, 
      'enchanted', 
      `Enchanted with "${enchantName}": ${effect}`
    );
    
    // Save changes
    this.saveItemInstances();
    return true;
  }
  
  /**
   * Make an item soulbound to a specific player
   */
  public bindItemToPlayer(instanceId: string, playerName: string): boolean {
    const instance = this.getItemInstance(instanceId);
    if (!instance) return false;
    
    // Initialize properties if needed
    if (!instance.properties) {
      instance.properties = {};
    }
    
    // Set soulbound properties
    instance.properties.soulbound = true;
    instance.properties.boundTo = playerName;
    
    // Add to history
    this.addItemHistory(
      instanceId, 
      'bound', 
      `Bound to ${playerName}`
    );
    
    // Save changes
    this.saveItemInstances();
    return true;
  }
  
  /**
   * Check if an item can be used by a specific player
   */
  public canUseItem(instanceId: string, playerName: string): boolean {
    const instance = this.getItemInstance(instanceId);
    if (!instance) return false;
    
    // If item is not soulbound, anyone can use it
    if (!instance.properties?.soulbound) return true;
    
    // If soulbound, check if bound to this player
    return instance.properties.boundTo === playerName;
  }

  /**
   * Calculate a user's attack value based on their equipment, now using instance IDs
   */
  public calculateAttack(user: User): number {
    // Base attack value (could be derived from strength or other stats)
    let attack = Math.floor(user.strength / 2);
    
    // Add bonuses from equipped items
    if (user.equipment) {
      Object.values(user.equipment).forEach(instanceId => {
        const template = this.getTemplateForInstance(instanceId);
        if (template?.stats?.attack) {
          attack += template.stats.attack;
        }
      });
    }
    
    return attack;
  }

  /**
   * Calculate a user's defense value based on their equipment, now using instance IDs
   */
  public calculateDefense(user: User): number {
    // Base defense value (could be derived from constitution or other stats)
    let defense = Math.floor(user.constitution / 2);
    
    // Add bonuses from equipped items
    if (user.equipment) {
      Object.values(user.equipment).forEach(instanceId => {
        const template = this.getTemplateForInstance(instanceId);
        if (template?.stats?.defense) {
          defense += template.stats.defense;
        }
      });
    }
    
    return defense;
  }

  /**
   * Calculate all stat bonuses from a user's equipment, now using instance IDs
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
      Object.values(user.equipment).forEach(instanceId => {
        const template = this.getTemplateForInstance(instanceId);
        if (template?.stats) {
          // Add each stat bonus
          if (template.stats.strength) bonuses.strength += template.stats.strength;
          if (template.stats.dexterity) bonuses.dexterity += template.stats.dexterity;
          if (template.stats.agility) bonuses.agility += template.stats.agility;
          if (template.stats.constitution) bonuses.constitution += template.stats.constitution;
          if (template.stats.wisdom) bonuses.wisdom += template.stats.wisdom;
          if (template.stats.intelligence) bonuses.intelligence += template.stats.intelligence;
          if (template.stats.charisma) bonuses.charisma += template.stats.charisma;
        }
      });
    }
    
    return bonuses;
  }

  /**
   * Get all items the user currently has equipped, now using instance IDs
   */
  public getEquippedItems(user: User): Map<string, GameItem> {
    const equippedItems = new Map<string, GameItem>();
    
    if (user.equipment) {
      Object.entries(user.equipment).forEach(([slot, instanceId]) => {
        const template = this.getTemplateForInstance(instanceId);
        if (template) {
          equippedItems.set(slot, template);
        }
      });
    }
    
    return equippedItems;
  }

  /**
   * Find instances by name for lookups
   */
  public findInstancesByName(name: string): ItemInstance[] {
    const instances: ItemInstance[] = [];
    const lowerName = name.toLowerCase();
    
    for (const instance of this.itemInstances.values()) {
      const template = this.getItem(instance.templateId);
      if (template && template.name.toLowerCase().includes(lowerName)) {
        instances.push(instance);
      }
    }
    
    return instances;
  }

  /**
   * Find an item instance in a user's inventory by name (partial match)
   * This helps commands work with names instead of just instance IDs
   */
  public findItemInInventory(user: User, itemName: string): string | null {
    if (!user.inventory || !user.inventory.items || user.inventory.items.length === 0) {
      return null;
    }
    
    // First try for exact instance ID match
    if (user.inventory.items.includes(itemName)) {
      return itemName;
    }
    
    // Check for exact name matches first
    for (const instanceId of user.inventory.items) {
      const instance = this.getItemInstance(instanceId);
      if (!instance) continue;
      
      // Check custom name if available
      if (instance.properties?.customName?.toLowerCase() === itemName.toLowerCase()) {
        return instanceId;
      }
      
      // Check template name
      const template = this.getItem(instance.templateId);
      if (template && template.name.toLowerCase() === itemName.toLowerCase()) {
        return instanceId;
      }
    }
    
    // If no exact match, check for partial matches
    for (const instanceId of user.inventory.items) {
      const instance = this.getItemInstance(instanceId);
      if (!instance) continue;
      
      // Check custom name if available
      if (instance.properties?.customName?.toLowerCase().includes(itemName.toLowerCase())) {
        return instanceId;
      }
      
      // Check template name
      const template = this.getItem(instance.templateId);
      if (template && template.name.toLowerCase().includes(itemName.toLowerCase())) {
        return instanceId;
      }
    }
    
    return null;
  }
  
  /**
   * Find an item instance in a room by name (partial match)
   * This helps commands work with names instead of just instance IDs
   */
  public findItemInRoom(room: any, itemName: string): string | null {
    if (!room.items || room.items.length === 0) {
      return null;
    }
    
    // Handle both string IDs and possible legacy object items in room
    const roomItems = room.items.map((item: any) => 
      typeof item === 'string' ? item : item.id || item
    );
    
    // First try for exact instance ID match
    if (roomItems.includes(itemName)) {
      return itemName;
    }
    
    // Check for exact name matches first
    for (const instanceId of roomItems) {
      if (typeof instanceId !== 'string') continue;
      
      const instance = this.getItemInstance(instanceId);
      if (!instance) continue;
      
      // Check custom name if available
      if (instance.properties?.customName?.toLowerCase() === itemName.toLowerCase()) {
        return instanceId;
      }
      
      // Check template name
      const template = this.getItem(instance.templateId);
      if (template && template.name.toLowerCase() === itemName.toLowerCase()) {
        return instanceId;
      }
    }
    
    // If no exact match, check for partial matches
    for (const instanceId of roomItems) {
      if (typeof instanceId !== 'string') continue;
      
      const instance = this.getItemInstance(instanceId);
      if (!instance) continue;
      
      // Check custom name if available
      if (instance.properties?.customName?.toLowerCase().includes(itemName.toLowerCase())) {
        return instanceId;
      }
      
      // Check template name
      const template = this.getItem(instance.templateId);
      if (template && template.name.toLowerCase().includes(itemName.toLowerCase())) {
        return instanceId;
      }
    }
    
    return null;
  }
  
  /**
   * Find an item instance in a user's inventory by name (partial match)
   * This helps commands work with names instead of just instance IDs
   */
  public findItemInEquipment(user: User, itemName: string): { slot: string, instanceId: string } | null {
    if (!user.equipment) {
      return null;
    }
    
    // First check if itemName is a slot name
    const normalizedItemName = itemName.toLowerCase();
    if (Object.keys(user.equipment).some(slot => slot.toLowerCase() === normalizedItemName)) {
      const slot = Object.keys(user.equipment).find(
        slot => slot.toLowerCase() === normalizedItemName
      );
      if (slot && user.equipment[slot]) {
        return { slot, instanceId: user.equipment[slot] };
      }
    }
    
    // Check if itemName is an instance ID
    for (const [slot, instanceId] of Object.entries(user.equipment)) {
      if (instanceId === itemName) {
        return { slot, instanceId };
      }
    }
    
    // Check for name matches among equipped items
    for (const [slot, instanceId] of Object.entries(user.equipment)) {
      const instance = this.getItemInstance(instanceId);
      if (!instance) continue;
      
      // Check custom name if available
      if (instance.properties?.customName?.toLowerCase() === itemName.toLowerCase()) {
        return { slot, instanceId };
      }
      
      // Check template name
      const template = this.getItem(instance.templateId);
      if (template && template.name.toLowerCase() === itemName.toLowerCase()) {
        return { slot, instanceId };
      }
    }
    
    // Check for partial name matches
    for (const [slot, instanceId] of Object.entries(user.equipment)) {
      const instance = this.getItemInstance(instanceId);
      if (!instance) continue;
      
      // Check custom name if available
      if (instance.properties?.customName?.toLowerCase().includes(itemName.toLowerCase())) {
        return { slot, instanceId };
      }
      
      // Check template name
      const template = this.getItem(instance.templateId);
      if (template && template.name.toLowerCase().includes(itemName.toLowerCase())) {
        return { slot, instanceId };
      }
    }
    
    return null;
  }

  /**
   * Delete an item instance by ID
   */
  public deleteItemInstance(instanceId: string): boolean {
    const deleted = this.itemInstances.delete(instanceId);
    if (deleted) {
      this.saveItemInstances();
      console.log(`[ItemManager] Deleted item instance ${instanceId}`);
    }
    return deleted;
  }

  /**
   * Find an item instance by a partial ID
   * Handles ambiguity by requiring longer ID prefixes when needed
   * @param partialId The partial ID to search for (minimum 8 characters)
   * @returns The matching item instance, null if not found, or undefined if ambiguous
   */
  public findInstanceByPartialId(partialId: string): ItemInstance | null | undefined {
    // If it's an exact match, return directly
    if (this.itemInstances.has(partialId)) {
      return this.itemInstances.get(partialId) || null;
    }
    
    // If the partial ID is less than 8 characters, it's too short
    if (partialId.length < 8) {
      return null;
    }
    
    // Look for instances where the characters match the partial ID
    const partialIdLower = partialId.toLowerCase();
    let matchingInstance: ItemInstance | null = null;
    let multipleMatches = false;
    
    for (const [instanceId, instance] of this.itemInstances.entries()) {
      if (instanceId.toLowerCase().startsWith(partialIdLower)) {
        // If we already found a match, this is a second match - ambiguous
        if (matchingInstance) {
          multipleMatches = true;
          break;
        }
        matchingInstance = instance;
      }
    }
    
    // Return undefined to signal ambiguity
    if (multipleMatches) {
      return undefined;
    }
    
    return matchingInstance;
  }

  /**
   * Get all item instances
   * Used for administrative purposes
   */
  public getAllItemInstances(): ItemInstance[] {
    return Array.from(this.itemInstances.values());
  }
}