import { formatUsername } from '../utils/formatters';
import { colorize } from '../utils/colors';
import { Currency, Exit, Item, ItemInstance } from '../types';
import { ItemManager } from '../utils/itemManager';
import { NPC } from '../combat/npc';
import { colorizeItemName } from '../utils/itemNameColorizer';

export class Room {
  id: string;
  name: string;
  description: string;
  exits: Exit[];
  players: string[] = [];
  
  // Replace items array with a map of instanceId -> templateId
  private itemInstances: Map<string, string> = new Map(); // instanceId -> templateId
  
  // Keep the old items array for backward compatibility during migration
  items: Item[] = [];
  
  currency: Currency = { gold: 0, silver: 0, copper: 0 };
  npcs: Map<string, NPC> = new Map();
  private itemManager: ItemManager;
  public hasChanged: boolean = false;

  constructor(room: any) {
    this.id = room.id;
    this.name = room.name || room.shortDescription;
    this.description = room.description || room.longDescription;
    this.exits = room.exits || [];
    this.players = room.players || [];
    
    // Initialize itemInstances
    this.itemInstances = new Map();
    if (room.itemInstances) {
      // If data has already been migrated to new format
      if (room.itemInstances instanceof Map) {
        this.itemInstances = room.itemInstances;
      } else if (Array.isArray(room.itemInstances)) {
        // Deserialize from JSON array format
        room.itemInstances.forEach((item: {instanceId: string, templateId: string}) => {
          this.itemInstances.set(item.instanceId, item.templateId);
        });
      }
    }
    
    // Initialize legacy items for backward compatibility
    this.items = room.items || room.objects || [];
    
    this.currency = room.currency || { gold: 0, silver: 0, copper: 0 };
    
    // Initialize NPCs
    this.npcs = new Map();
    if (room.npcs) {
      if (Array.isArray(room.npcs)) {
        // Old format: convert string[] to Map
        // This will be handled by RoomManager when loading NPCs
      } else if (room.npcs instanceof Map) {
        // New format: already a Map
        this.npcs = room.npcs;
      }
    }
    
    this.itemManager = ItemManager.getInstance();
  }

  addPlayer(username: string): void {
    if (!this.players.includes(username)) {
      this.players.push(username);
    }
  }

  removePlayer(username: string): void {
    this.players = this.players.filter(player => player !== username);
  }

  /**
   * Add an NPC to the room
   */
  addNPC(npc: NPC): void {
    this.npcs.set(npc.instanceId, npc);
  }

  /**
   * Remove an NPC from the room
   */
  removeNPC(instanceId: string): void {
    this.npcs.delete(instanceId);
  }

  /**
   * Find NPCs in the room by template ID
   */
  findNPCsByTemplateId(templateId: string): NPC[] {
    const matchingNPCs: NPC[] = [];
    for (const npc of this.npcs.values()) {
      if (npc.templateId === templateId) {
        matchingNPCs.push(npc);
      }
    }
    return matchingNPCs;
  }

  /**
   * Get an NPC by its instance ID
   */
  getNPC(instanceId: string): NPC | undefined {
    return this.npcs.get(instanceId);
  }

  /**
   * Add an item instance to the room
   */
  addItemInstance(instanceId: string, templateId: string): void {
    this.itemInstances.set(instanceId, templateId);
    this.hasChanged = true;
  }

  /**
   * Remove an item instance from the room - now supporting partial IDs
   * with proper handling of ambiguous matches
   */
  removeItemInstance(instanceId: string): boolean {
    // Try direct match first (most efficient)
    if (this.itemInstances.has(instanceId)) {
      const result = this.itemInstances.delete(instanceId);
      if (result) {
        this.hasChanged = true;
      }
      return result;
    }
    
    // Try to find by partial ID, which handles ambiguity
    const matchedId = this.findItemInstanceId(instanceId);
    
    // If undefined, it means multiple items matched (ambiguous)
    if (matchedId === undefined) {
      return false;
    }
    
    // If a unique match was found, remove it
    if (matchedId) {
      const result = this.itemInstances.delete(matchedId);
      if (result) {
        this.hasChanged = true;
      }
      return result;
    }
    
    return false;
  }

  /**
   * Check if room has an item instance - now supporting partial IDs
   * with proper handling of ambiguous matches
   */
  hasItemInstance(instanceId: string): boolean | undefined {
    // Check for direct match first (most efficient)
    if (this.itemInstances.has(instanceId)) {
      return true;
    }
    
    // Try to find by partial ID, which handles ambiguity
    const matchedId = this.findItemInstanceId(instanceId);
    
    // If undefined, it means multiple items matched (ambiguous)
    if (matchedId === undefined) {
      return undefined;
    }
    
    // Return true if a matching ID was found, false otherwise
    return !!matchedId;
  }

  /**
   * Get a matching item instance ID from a partial ID
   * Returns the full ID if found, null if not found, or undefined if ambiguous
   */
  findItemInstanceId(partialId: string): string | null | undefined {
    // Try direct match first (most efficient)
    if (this.itemInstances.has(partialId)) {
      return partialId;
    }
    
    // If not found and at least 8 characters long, try matching by partial ID
    if (partialId.length >= 8) {
      const partialIdLower = partialId.toLowerCase();
      let matchingId: string | null = null;
      let multipleMatches = false;
      
      // Check for matches
      for (const existingId of this.itemInstances.keys()) {
        if (existingId.toLowerCase().startsWith(partialIdLower)) {
          // If we already found a match, this is ambiguous
          if (matchingId) {
            multipleMatches = true;
            break;
          }
          matchingId = existingId;
        }
      }
      
      // Return undefined to signal ambiguity
      if (multipleMatches) {
        return undefined;
      }
      
      return matchingId;
    }
    
    return null;
  }

  /**
   * Get all item instances in the room
   */
  getItemInstances(): Map<string, string> {
    return new Map(this.itemInstances);
  }

  /**
   * Serialize item instances for JSON storage
   */
  serializeItemInstances(): Array<{instanceId: string, templateId: string}> {
    return Array.from(this.itemInstances.entries()).map(([instanceId, templateId]) => ({
      instanceId,
      templateId
    }));
  }

  /**
   * Legacy method for backward compatibility
   */
  addItem(item: string | {name: string}): void {
    // Convert string IDs to Item objects before adding to the array
    if (typeof item === 'object' && item !== null && 'name' in item) {
      this.items.push(item as Item);
    } else if (typeof item === 'string') {
      // Convert string to item object with proper name property
      this.items.push({name: item} as Item);
    }
    this.hasChanged = true;
  }

  /**
   * Get a proper name for an item, handling both string IDs and objects
   * @param item The item object or string ID
   * @returns The name to display for the item
   */
  private getItemName(item: any): string {
    if (typeof item === 'object' && item !== null && 'name' in item) {
      return item.name;
    } else if (typeof item === 'string') {
      // Look up the item name from the ItemManager
      const itemData = this.itemManager.getItem(item);
      if (itemData) {
        return itemData.name;
      }
      return item;
    }
    return "unknown item"; // Fallback for invalid items
  }

  // Update getDescription method to include NPCs
  getDescription(): string {
    let output = this.getFormattedDescription(true);

    // Add NPCs to description if any
    if (this.npcs.size > 0) {
      // Count occurrences of each NPC type
      const npcCounts = new Map<string, number>();
      for (const npc of this.npcs.values()) {
        npcCounts.set(npc.name, (npcCounts.get(npc.name) || 0) + 1);
      }

      output += '\r\nAlso here: ';
      
      const npcStrings: string[] = [];
      npcCounts.forEach((count, npcName) => {
        if (count === 1) {
          npcStrings.push(`a ${npcName}`);
        } else {
          npcStrings.push(`${count} ${npcName}s`);
        }
      });
      
      output += npcStrings.join(', ') + '.\r\n';
    }

    return output;
  }

  getDescriptionExcludingPlayer(username: string): string {
    return this.getFormattedDescription(true, username);
  }

  getBriefDescription(): string {
    return this.getFormattedDescription(false);
  }

  getBriefDescriptionExcludingPlayer(username: string): string {
    return this.getFormattedDescription(false, username);
  }

  /**
   * Generate a description for someone looking into the room from outside
   */
  getDescriptionForPeeking(fromDirection: string): string {
    let description = colorize(this.name, 'cyan') + '\r\n';
    description += colorize(this.description, 'white') + '\r\n';
    
    // Show players in the room
    if (this.players.length > 0) {
      description += colorize(`You can see some figures moving around.\r\n`, 'yellow');
    }
    
    // Show NPCs in the room
    if (this.npcs.size > 0) {
      description += colorize(`You can see some creatures moving around.\r\n`, 'yellow');
    }
    
    // Show items in the room (simplified view when peeking)
    if (this.items.length > 0 || 
        (this.currency.gold > 0 || this.currency.silver > 0 || this.currency.copper > 0)) {
      description += colorize(`You can see some items in the distance.\r\n`, 'green');
    }
    
    // Only show exits since player is just peeking
    if (this.exits.length > 0) {
      const directions = this.exits.map(exit => exit.direction);
      description += colorize(`Obvious exits: ${directions.join(', ')}.\r\n`, 'green');
      
      // Mention the direction the player is peeking from
      description += colorize(`You are looking into this room from the ${fromDirection}.\r\n`, 'yellow');
    } else {
      description += colorize('There are no obvious exits.\r\n', 'green');
    }
    
    return description;
  }

  // Centralized method to format room descriptions
  private getFormattedDescription(includeLongDesc: boolean, excludePlayer?: string): string {
    let description = colorize(this.name, 'cyan') + '\r\n';
    
    if (includeLongDesc) {
      description += colorize(this.description, 'white') + '\r\n';
    }
    
    // Add the common parts
    description += this.getFormattedCommonDescription(excludePlayer);
    
    return description;
  }

  // Centralized method for common description formatting
  private getFormattedCommonDescription(excludePlayer?: string): string {
    let description = '';

    // Add currency description if there's any
    if (this.currency.gold > 0 || this.currency.silver > 0 || this.currency.copper > 0) {
      const currencyParts = [];
      if (this.currency.gold > 0) {
        currencyParts.push(`${this.currency.gold} gold piece${this.currency.gold === 1 ? '' : 's'}`);
      }
      if (this.currency.silver > 0) {
        currencyParts.push(`${this.currency.silver} silver piece${this.currency.silver === 1 ? '' : 's'}`);
      }
      if (this.currency.copper > 0) {
        currencyParts.push(`${this.currency.copper} copper piece${this.currency.copper === 1 ? '' : 's'}`);
      }
      
      let currencyText = currencyParts.join(', ');
      if (currencyParts.length > 1) {
        const lastPart = currencyParts.pop();
        currencyText = `${currencyParts.join(', ')}, and ${lastPart}`;
      }
      
      description += colorize(`You notice ${currencyText} here.`, 'green') + '\r\n';
    }

    // Combined approach: collect all items but preserve ordering with static items first
    const allItemDescriptions: { name: string, count: number }[] = [];
    
    // First, add legacy/static items from room.items
    if (this.items.length > 0) {
      const legacyNameCounts = new Map<string, number>();
      
      this.items.forEach(item => {
        const name = this.getItemName(item);
        legacyNameCounts.set(name, (legacyNameCounts.get(name) || 0) + 1);
      });
      
      // Add legacy items to the beginning of the display list
      legacyNameCounts.forEach((count, name) => {
        allItemDescriptions.push({ name, count });
      });
    }
    
    // Next, add item instances from room.itemInstances
    if (this.itemInstances.size > 0) {
      const instanceNameCounts = new Map<string, number>();
      
      for (const [instanceId, templateId] of this.itemInstances.entries()) {
        // Get the template for the proper name
        const template = this.itemManager.getItem(templateId);
        if (template) {
          // Get the instance for any custom name
          const instance = this.itemManager.getItemInstance(instanceId);
          // Use custom name if available, otherwise template name
          const rawDisplayName = instance?.properties?.customName || template.name;
          
          // Count items with the same display name
          instanceNameCounts.set(rawDisplayName, (instanceNameCounts.get(rawDisplayName) || 0) + 1);
        }
      }
      
      // Add instance items after the legacy items
      instanceNameCounts.forEach((count, name) => {
        allItemDescriptions.push({ name, count });
      });
    }
    
    // Format and display all items together in a single line
    if (allItemDescriptions.length > 0) {
      const itemTexts: string[] = allItemDescriptions.map(item => {
        // Process color codes in item name with quality-based colors
        let processedName;
        
        // For item instances (with quality), get the instance and apply quality-based color
        if (this.itemInstances.size > 0) {
          // Look for the instance with this name
          for (const [instanceId, templateId] of this.itemInstances.entries()) {
            const instance = this.itemManager.getItemInstance(instanceId);
            const displayName = instance?.properties?.customName || 
                                (this.itemManager.getItem(templateId)?.name || "");
                                
            if (displayName === item.name && instance) {
              // Found the matching instance, apply quality-based color
              processedName = colorizeItemName(item.name, 'white', instance);
              break;
            }
          }
        }
        
        // If we haven't found a matching instance, use normal colorization
        if (!processedName) {
          processedName = colorizeItemName(item.name);
        }
        
        if (item.count === 1) {
          return `a ${processedName}`;
        } else {
          return `${item.count} ${processedName}s`;
        }
      });
      
      if (itemTexts.length === 1) {
        description += colorize(`You see ${itemTexts[0]}.`, 'green') + '\r\n';
      } else {
        const lastItem = itemTexts.pop();
        description += colorize(`You see ${itemTexts.join(', ')}, and ${lastItem}.`, 'green') + '\r\n';
      }
    }

    // Add players and NPCs
    let players = this.players;
    if (excludePlayer) {
      players = this.players.filter(player => player !== excludePlayer);
    }

    const entities = [
      ...players.map(player => colorize(formatUsername(player), 'brightMagenta')),
      ...Array.from(this.npcs.values()).map(npc => colorize(`a ${npc.name}`, 'magenta'))
    ];
    
    if (entities.length > 0) {
      description += colorize(`Also here: ${entities.join(', ')}.`, 'magenta') + '\r\n';
    }

    // Add exits
    if (this.exits.length > 0) {
      const directions = this.exits.map(exit => exit.direction);
      description += colorize(`Obvious exits: ${directions.join(', ')}.`, 'green') + '\r\n';
    } else {
      description += colorize('There are no obvious exits.', 'green') + '\r\n';
    }

    return description;
  }

  getExit(direction: string): string | null {
    const exit = this.exits.find(e => 
      e.direction.toLowerCase() === direction.toLowerCase() ||
      this.getDirectionAbbreviation(e.direction) === direction.toLowerCase()
    );
    return exit ? exit.roomId : null;
  }

  private getDirectionAbbreviation(direction: string): string {
    switch (direction.toLowerCase()) {
      case 'north': return 'n';
      case 'south': return 's';
      case 'east': return 'e';
      case 'west': return 'w';
      case 'northeast': return 'ne';
      case 'northwest': return 'nw';
      case 'southeast': return 'se';
      case 'southwest': return 'sw';
      case 'up': return 'u';
      case 'down': return 'd';
      default: return '';
    }
  }
}
