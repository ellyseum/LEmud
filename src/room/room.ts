import { formatUsername } from '../utils/formatters';

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
    let description = `${this.shortDescription}\r\n${this.longDescription}\r\n`;
    return description + this.getCommonDescription();
  }

  // New method for brief room description (omits longDescription)
  getBriefDescription(): string {
    let description = `${this.shortDescription}\r\n`;
    return description + this.getCommonDescription();
  }

  // Private helper method to generate the common parts of room descriptions
  private getCommonDescription(): string {
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
      
      description += `There is ${currencyText} on the ground.\r\n`;
    }

    // Add objects description
    if (this.objects.length > 0) {
      if (this.objects.length === 1) {
        description += `You see a ${this.objects[0]}.\r\n`;
      } else {
        const lastObject = this.objects[this.objects.length - 1];
        const otherObjects = this.objects.slice(0, -1).map(obj => `a ${obj}`).join(', ');
        description += `You see ${otherObjects}, and a ${lastObject}.\r\n`;
      }
    }

    // Add players and NPCs
    const entities = [
      ...this.players.map(player => formatUsername(player)),
      ...this.npcs.map(npc => `a ${npc}`)
    ];
    
    if (entities.length > 0) {
      description += `Also here: ${entities.join(', ')}.\r\n`;
    }

    // Add exits
    if (this.exits.length > 0) {
      const directions = this.exits.map(exit => exit.direction);
      description += `Obvious exits: ${directions.join(', ')}.\r\n`;
    } else {
      description += 'There are no obvious exits.\r\n';
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
