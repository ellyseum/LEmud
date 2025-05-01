import { IDirectionHelper } from '../interfaces';

export class DirectionHelper implements IDirectionHelper {
  /**
   * Get the opposite direction of movement
   */
  public getOppositeDirection(direction: string): string {
    switch (direction.toLowerCase()) {
      case 'north': return 'south';
      case 'south': return 'north';
      case 'east': return 'west';
      case 'west': return 'east';
      case 'up': return 'below';
      case 'down': return 'above';
      case 'northeast': return 'southwest';
      case 'northwest': return 'southeast';
      case 'southeast': return 'northwest';
      case 'southwest': return 'northeast';
      // Handle abbreviations too
      case 'n': return 'south';
      case 's': return 'north';
      case 'e': return 'west';
      case 'w': return 'east';
      case 'ne': return 'southwest';
      case 'nw': return 'southeast';
      case 'se': return 'northwest';
      case 'sw': return 'northeast';
      case 'u': return 'below';
      case 'd': return 'above';
      default: return 'somewhere';
    }
  }

  /**
   * Convert direction abbreviation to full name
   */
  public getFullDirectionName(direction: string): string {
    switch (direction.toLowerCase()) {
      case 'n': return 'north';
      case 's': return 'south';
      case 'e': return 'east';
      case 'w': return 'west';
      case 'ne': return 'northeast';
      case 'nw': return 'northwest';
      case 'se': return 'southeast';
      case 'sw': return 'southwest';
      case 'u': return 'up';
      case 'd': return 'down';
      default: return direction.toLowerCase(); // Return the original if it's already a full name
    }
  }
}