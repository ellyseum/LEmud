import { formatUsername } from '../utils/formatters';
import { colorize } from '../utils/colors';

export interface Currency {
  gold: number;
  silver: number;
  copper: number;
}

export interface Exit {
  direction: string;
  roomId: string;
}

export class Room {
  id: string;
  shortDescription: string;
  longDescription: string;
  exits: Exit[];
  objects: string[];
  npcs: string[];
  players: string[];
  currency: Currency;

  constructor(data: {
    id: string;
    shortDescription: string;
    longDescription: string;
    exits?: Exit[];
    objects?: string[];
    npcs?: string[];
    players?: string[];
    currency?: Currency;
  }) {
    this.id = data.id;
    this.shortDescription = data.shortDescription;
    this.longDescription = data.longDescription;
    this.exits = data.exits || [];
    this.objects = data.objects || [];
    this.npcs = data.npcs || [];
    this.players = data.players || [];
    this.currency = data.currency || { gold: 0, silver: 0, copper: 0 };
  }

  addPlayer(username: string): void {
    if (!this.players.includes(username)) {
      this.players.push(username);
    }
  }

  removePlayer(username: string): void {
    this.players = this.players.filter(player => player !== username);
  }

  getDescription(): string {
    return this.getFormattedDescription(true);
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
    let description = colorize(this.shortDescription, 'cyan') + '\r\n';
    description += colorize(this.longDescription, 'white') + '\r\n';
    
    // Show players in the room
    if (this.players.length > 0) {
      const playerNames = this.players.map(player => formatUsername(player));
      description += colorize(`Also here: ${playerNames.join(', ')}.\r\n`, 'magenta');
    }
    
    // Show objects in the room (simplified view when peeking)
    if (this.objects.length > 0) {
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
    let description = colorize(this.shortDescription, 'cyan') + '\r\n';
    
    if (includeLongDesc) {
      description += colorize(this.longDescription, 'white') + '\r\n';
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

    // Add objects description
    if (this.objects.length > 0) {
      if (this.objects.length === 1) {
        description += colorize(`You see a ${this.objects[0]}.`, 'green') + '\r\n';
      } else {
        const lastObject = this.objects[this.objects.length - 1];
        const otherObjects = this.objects.slice(0, -1).map(obj => `a ${obj}`).join(', ');
        description += colorize(`You see ${otherObjects}, and a ${lastObject}.`, 'green') + '\r\n';
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
