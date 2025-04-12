import { formatUsername } from '../utils/formatters';
import { colorize } from '../utils/colors';
import { Currency, Exit, Item } from '../types';
import { ItemManager } from '../utils/itemManager';
import { NPC } from '../combat/npc';

export class Room {
  id: string;
  name: string;
  description: string;
  exits: Exit[];
  players: string[] = [];
  items: Item[] = [];
  currency: Currency = { gold: 0, silver: 0, copper: 0 };
  // Changed from string[] to Map<instanceId, NPC>
  npcs: Map<string, NPC> = new Map();
  private itemManager: ItemManager;

  constructor(room: any) {
    this.id = room.id;
    this.name = room.name || room.shortDescription;
    this.description = room.description || room.longDescription;
    this.exits = room.exits || [];
    this.players = room.players || [];
    this.items = room.items || room.objects || [];
    this.currency = room.currency || { gold: 0, silver: 0, copper: 0 };
    
    // Initialize NPCs - handle both old string[] format and new Map format
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
   * Add an item to the room
   */
  addItem(item: string | {name: string}): void {
    // Convert string IDs to Item objects before adding to the array
    if (typeof item === 'object' && item !== null && 'name' in item) {
      this.items.push(item as Item);
    } else if (typeof item === 'string') {
      // Convert string to item object with proper name property
      this.items.push({name: item} as Item);
    }
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

    // Add items description
    if (this.items.length > 0) {
      if (this.items.length === 1) {
        description += colorize(`You see a ${this.getItemName(this.items[0])}.`, 'green') + '\r\n';
      } else {
        const lastItem = this.getItemName(this.items[this.items.length - 1]);
        const otherItems = this.items.slice(0, -1).map(item => `a ${this.getItemName(item)}`).join(', ');
        description += colorize(`You see ${otherItems}, and a ${lastItem}.`, 'green') + '\r\n';
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
