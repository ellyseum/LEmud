import { ConnectedClient } from '../types';
import { Combat } from './combat';
import { CombatEntity } from './combatEntity.interface';
import { colorize } from '../utils/colors';
import { writeMessageToClient } from '../utils/socketWriter';
import { UserManager } from '../user/userManager';
import { NPC } from './npc';
import { RoomManager } from '../room/roomManager';
import { formatUsername } from '../utils/formatters';

export class CombatSystem {
  private combats: Map<string, Combat> = new Map();
  
  constructor(
    private userManager: UserManager,
    private roomManager: RoomManager
  ) {}

  /**
   * Engage a player in combat with a target
   */
  engageCombat(player: ConnectedClient, target: CombatEntity): boolean {
    if (!player.user) return false;

    // Check if player is already in combat
    let combat = this.combats.get(player.user.username);
    
    // If not, create a new combat
    if (!combat) {
      combat = new Combat(player, this.userManager, this.roomManager);
      this.combats.set(player.user.username, combat);
      
      // Clear the line and set combat status BEFORE sending any messages
      if (player.connection.getType() === 'telnet') {
        // Clear line sequence
        player.connection.write('\r\x1B[K');
      }
      
      // Set the inCombat flag BEFORE sending the message
      player.user.inCombat = true;
      this.userManager.updateUserStats(player.user.username, { inCombat: true });
      
      // Message to the player - this will now already use the combat prompt
      writeMessageToClient(
        player,
        colorize(`*Combat Engaged*\r\n`, 'boldYellow')
      );
      
      // Broadcast initial attack message (only place where this message is sent now)
      this.broadcastCombatStart(player, target);
    }
    
    // Add the target to combat
    combat.addTarget(target);
    
    return true;
  }

  /**
   * Broadcast combat start to other players in the room
   */
  private broadcastCombatStart(player: ConnectedClient, target: CombatEntity): void {
    if (!player.user || !player.user.currentRoomId) return;
    
    const room = this.roomManager.getRoom(player.user.currentRoomId);
    if (!room) return;
    
    const username = formatUsername(player.user.username);
    // Don't add extra line breaks - they will be handled by the writeMessageToClient function
    const message = colorize(`${username} moves to attack ${target.name}!\r\n`, 'boldYellow');
    
    for (const playerName of room.players) {
      // Skip the player who started combat
      if (playerName === player.user.username) continue;
      
      // Find client for this player
      const client = this.findClientByUsername(playerName);
      if (client) {
        writeMessageToClient(client, message);
      }
    }
  }

  /**
   * Find a client by username
   */
  private findClientByUsername(username: string): ConnectedClient | undefined {
    for (const client of this.roomManager['clients'].values()) {
      if (client.user && client.user.username.toLowerCase() === username.toLowerCase()) {
        return client;
      }
    }
    return undefined;
  }

  /**
   * Process combat rounds for all active combats
   */
  processCombatRound(): void {
    // Process each combat
    for (const [username, combat] of this.combats.entries()) {
      combat.processRound();
      
      // Check if combat is done
      if (combat.isDone()) {
        combat.endCombat();
        this.combats.delete(username);
      }
    }
  }

  /**
   * Attempt to break combat for a player
   */
  breakCombat(player: ConnectedClient): boolean {
    if (!player.user) return false;
    
    const combat = this.combats.get(player.user.username);
    if (!combat) return false;
    
    combat.brokenByPlayer = true;
    
    writeMessageToClient(
      player,
      colorize(`You attempt to break combat...\r\n`, 'boldYellow')
    );
    
    // Broadcast to room with proper line handling
    if (player.user && player.user.currentRoomId) {
      const room = this.roomManager.getRoom(player.user.currentRoomId);
      if (room) {
        const username = formatUsername(player.user.username);
        const message = colorize(`${username} attempts to break combat...\r\n`, 'boldYellow');
        
        for (const playerName of room.players) {
          // Skip the player who is breaking combat
          if (playerName === player.user.username) continue;
          
          // Find client for this player
          const client = this.findClientByUsername(playerName);
          if (client) {
            writeMessageToClient(client, message);
          }
        }
      }
    }
    
    return true;
  }

  /**
   * Check if a player is in combat
   */
  isInCombat(player: ConnectedClient): boolean {
    if (!player.user) return false;
    return this.combats.has(player.user.username);
  }

  /**
   * Create a test NPC for development
   */
  createTestNPC(name: string = 'cat'): NPC {
    return new NPC(
      name,
      20,  // health
      20,  // maxHealth
      [1, 3],  // damage range
      false,  // isHostile
      false,  // isPassive
      100  // experienceValue
    );
  }
}
