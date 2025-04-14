import { ConnectedClient } from '../../types';
import { systemLogger, getPlayerLogger } from '../../utils/logger';
import { RoomManager } from '../../room/roomManager';
import { UserManager } from '../../user/userManager';
import { formatUsername } from '../../utils/formatters';
import { CombatNotifier } from './CombatNotifier';

/**
 * Responsible for handling player death, unconsciousness, and respawning
 */
export class PlayerDeathHandler {
  constructor(
    private userManager: UserManager,
    private roomManager: RoomManager,
    private combatNotifier: CombatNotifier
  ) {}

  /**
   * Handle player death or unconsciousness
   */
  handlePlayerHealth(player: ConnectedClient, roomId: string): void {
    if (!player.user || player.user.health > 0) return;
    
    // Determine if player is dead or unconscious
    if (player.user.health <= -10) {
      this.handlePlayerDeath(player, roomId);
    } else {
      this.handlePlayerUnconscious(player, roomId);
    }
  }

  /**
   * Handle player death (HP <= -10)
   */
  private handlePlayerDeath(player: ConnectedClient, roomId: string): void {
    if (!player.user) return;
    
    // Notify player and room
    this.combatNotifier.notifyPlayerDeath(player, roomId);
    
    // Drop all inventory items
    this.dropPlayerInventory(player, roomId);
    
    // Teleport to starting room
    this.teleportToStartingRoom(player);
    
    // Log the death
    const playerLogger = getPlayerLogger(player.user.username);
    playerLogger.info(`Player died and was respawned in the starting room`);
  }

  /**
   * Handle player unconsciousness (0 > HP > -10)
   */
  private handlePlayerUnconscious(player: ConnectedClient, roomId: string): void {
    if (!player.user) return;
    
    // Notify player and room
    this.combatNotifier.notifyPlayerUnconscious(player, roomId);
    
    // Mark player as unconscious
    player.user.isUnconscious = true;
    this.userManager.updateUserStats(player.user.username, { isUnconscious: true });
    
    // Log the unconsciousness
    const playerLogger = getPlayerLogger(player.user.username);
    playerLogger.info(`Player fell unconscious at ${player.user.health} HP`);
  }

  /**
   * Drop player's inventory items on death
   */
  private dropPlayerInventory(player: ConnectedClient, roomId: string): void {
    if (!player.user || !player.user.inventory) return;
    
    const room = this.roomManager.getRoom(roomId);
    if (!room) return;
    
    // Drop all items
    if (player.user.inventory.items && player.user.inventory.items.length > 0) {
      const username = formatUsername(player.user.username);
      
      // Announce dropped items to the room
      const itemsList = player.user.inventory.items.join(', ');
      const dropMessage = `${username}'s corpse drops: ${itemsList}.\r\n`;
      this.combatNotifier.broadcastRoomMessage(roomId, dropMessage, 'cyan');
      
      // Add items to the room
      for (const item of player.user.inventory.items) {
        room.addItem(item);
      }
      
      // Clear player's inventory
      player.user.inventory.items = [];
    }
    
    // Transfer currency to the room
    if (player.user.inventory.currency) {
      const currency = player.user.inventory.currency;
      
      // Only announce/transfer if there's actual currency
      if (currency.gold > 0 || currency.silver > 0 || currency.copper > 0) {
        // Add currency to room
        room.currency.gold += currency.gold || 0;
        room.currency.silver += currency.silver || 0;
        room.currency.copper += currency.copper || 0;
        
        // Clear player's currency
        player.user.inventory.currency = { gold: 0, silver: 0, copper: 0 };
        
        // Announce currency drop to the room if there was any
        const username = formatUsername(player.user.username);
        const currencyText = this.formatCurrencyText(currency);
        if (currencyText) {
          const dropMessage = `${username}'s corpse drops ${currencyText}.\r\n`;
          this.combatNotifier.broadcastRoomMessage(roomId, dropMessage, 'cyan');
        }
      }
    }
    
    // Update the room
    this.roomManager.updateRoom(room);
    
    // Update the player's inventory in the database
    this.userManager.updateUserStats(player.user.username, { inventory: player.user.inventory });
  }
  
  /**
   * Format currency for display
   */
  private formatCurrencyText(currency: {gold?: number, silver?: number, copper?: number}): string {
    const parts = [];
    if (currency.gold && currency.gold > 0) parts.push(`${currency.gold} gold`);
    if (currency.silver && currency.silver > 0) parts.push(`${currency.silver} silver`);
    if (currency.copper && currency.copper > 0) parts.push(`${currency.copper} copper`);
    
    if (parts.length === 0) return '';
    return parts.join(', ');
  }

  /**
   * Teleport player to the starting room on death
   */
  private teleportToStartingRoom(player: ConnectedClient): void {
    if (!player.user) return;
    
    const startingRoomId = this.roomManager.getStartingRoomId();
    const currentRoomId = player.user.currentRoomId;
    
    if (currentRoomId) {
      // Remove from current room
      const currentRoom = this.roomManager.getRoom(currentRoomId);
      if (currentRoom) {
        currentRoom.removePlayer(player.user.username);
        this.roomManager.updateRoom(currentRoom);
      }
    }
    
    // Add to starting room
    const startingRoom = this.roomManager.getRoom(startingRoomId);
    if (startingRoom) {
      startingRoom.addPlayer(player.user.username);
      this.roomManager.updateRoom(startingRoom);
      
      // Update player's current room
      player.user.currentRoomId = startingRoomId;
      
      // Restore player to full health 
      player.user.health = player.user.maxHealth;
      
      // Clear the unconscious state
      player.user.isUnconscious = false;
      
      // Update the user stats all at once
      this.userManager.updateUserStats(player.user.username, { 
        currentRoomId: startingRoomId,
        health: player.user.maxHealth,
        isUnconscious: false
      });
      
      // Show the starting room to the player
      this.combatNotifier.notifyPlayerTeleported(player, startingRoom);
    }
  }
}