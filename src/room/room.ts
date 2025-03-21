import { formatUsername } from '../utils/formatters';
import { colorize } from '../utils/colors';
import { Currency, Exit, Item } from '../types';

export class Room {
  id: string;
  name: string;
  description: string;
  exits: Exit[];
  players: string[] = [];
  items: Item[] = [];
  currency: Currency = { gold: 0, silver: 0, copper: 0 };
  npcs: string[] = []; // Add NPCs array to track monsters in the room

  constructor(room: any) {
    this.id = room.id;
    this.name = room.name || room.shortDescription;
    this.description = room.description || room.longDescription;
    this.exits = room.exits || [];
    this.players = room.players || [];
    this.items = room.items || room.objects || [];
    this.currency = room.currency || { gold: 0, silver: 0, copper: 0 };
    this.npcs = room.npcs || []; // Initialize NPCs
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
  addNPC(npcName: string): void {
    if (!this.npcs.includes(npcName)) {
      this.npcs.push(npcName);
    }
  }

  /**
   * Remove an NPC from the room
   */
  removeNPC(npcName: string): void {
    this.npcs = this.npcs.filter(name => name !== npcName);
  }

  // Update getDescription method to include NPCs
  getDescription(): string {
    let output = this.getFormattedDescription(true);

    // Add NPCs to description if any
    if (this.npcs.length > 0) {
      // Count occurrences of each NPC type
      const npcCounts = new Map<string, number>();
      this.npcs.forEach(npc => {
        npcCounts.set(npc, (npcCounts.get(npc) || 0) + 1);
      });

      output += '\r\nAlso here: ';
      
      const npcStrings: string[] = [];
      npcCounts.forEach((count, npc) => {
        if (count === 1) {
          npcStrings.push(`a ${npc}`);
        } else {
          npcStrings.push(`${count} ${npc}s`);
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
    if (this.npcs.length > 0) {
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
        description += colorize(`You see a ${this.items[0]}.`, 'green') + '\r\n';
      } else {
        const lastItem = this.items[this.items.length - 1];
        const otherItems = this.items.slice(0, -1).map(item => `a ${item}`).join(', ');
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
      ...this.npcs.map(npc => colorize(`a ${npc}`, 'magenta'))
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
