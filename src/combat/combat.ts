import { ConnectedClient } from '../types';
import { CombatEntity } from './combatEntity.interface';
import { colorize } from '../utils/colors';
import { writeToClient, writeMessageToClient, writeFormattedMessageToClient } from '../utils/socketWriter';
import { UserManager } from '../user/userManager';
import { RoomManager } from '../room/roomManager';
import { formatUsername } from '../utils/formatters';

// Define color type to match what colorize accepts
type ColorType = 'blink' | 'reset' | 'bright' | 'dim' | 'underscore' | 'reverse' | 'hidden' |
                'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' |
                'boldBlack' | 'boldRed' | 'boldGreen' | 'boldYellow' | 'boldBlue' |
                'boldMagenta' | 'boldCyan' | 'boldWhite' | 'clear';

export class Combat {
  rounds: number = 0;
  activeCombatants: CombatEntity[] = [];
  brokenByPlayer: boolean = false;
  
  constructor(
    public player: ConnectedClient,
    private userManager: UserManager,
    private roomManager: RoomManager
  ) {}

  addTarget(target: CombatEntity): void {
    if (!this.activeCombatants.includes(target)) {
      this.activeCombatants.push(target);
      
      // The initial attack message will be handled solely by CombatSystem.engageCombat
      // Removing broadcast from here to prevent duplication
    }
  }

  processRound(): void {
    if (!this.player.user || this.isDone()) return;

    this.rounds++;
    
    // Process each combatant
    for (let i = 0; i < this.activeCombatants.length; i++) {
      const target = this.activeCombatants[i];
      
      if (!target.isAlive()) {
        // Process death
        this.handleNpcDeath(target);
        continue;
      }
      
      // Player attacks target
      this.processAttack(this.player, target);
      
      // If target dies from the attack, continue to next target
      if (!target.isAlive()) {
        this.handleNpcDeath(target);
        continue;
      }
      
      // Target counterattacks if not passive
      if (!target.isPassive) {
        this.processCounterAttack(target, this.player);
      }
    }
    
    // Remove dead combatants
    this.activeCombatants = this.activeCombatants.filter(c => c.isAlive());
  }

  private processAttack(player: ConnectedClient, target: CombatEntity): void {
    if (!player.user) return;
    
    // 50% chance to hit
    const hit = Math.random() >= 0.5;
    
    if (hit) {
      // Calculate damage (temporary range of 5-10)
      const damage = Math.floor(Math.random() * 6) + 5;
      const actualDamage = target.takeDamage(damage);
      
      // Send message to the player
      writeFormattedMessageToClient(
        player,
        colorize(`You hit the ${target.name} with your fists for ${actualDamage} damage.\r\n`, 'red')
      );
      
      // Broadcast to others using RED color for hits
      if (player.user) {
        const username = formatUsername(player.user.username);
        this.broadcastCombatMessage(`${username} hits the ${target.name} with their fists for ${actualDamage} damage.\r\n`, 'red', true);
      }
    } else {
      // Send message to the player
      writeFormattedMessageToClient(
        player,
        colorize(`You swing at the ${target.name} with your fists, and miss!\r\n`, 'cyan')
      );
      
      // Broadcast to others using CYAN color for misses
      if (player.user) {
        const username = formatUsername(player.user.username);
        this.broadcastCombatMessage(`${username} swings at the ${target.name} with their fists, and misses!\r\n`, 'cyan', true);
      }
    }
  }

  private processCounterAttack(npc: CombatEntity, player: ConnectedClient): void {
    if (!player.user) return;
    
    // 50% chance to hit
    const hit = Math.random() >= 0.5;
    
    if (hit) {
      const damage = npc.getAttackDamage();
      player.user.health -= damage;
      
      // Ensure health doesn't go below 0
      if (player.user.health < 0) player.user.health = 0;
      
      // Update the player's health
      this.userManager.updateUserStats(player.user.username, { health: player.user.health });
      
      // Send message to the player
      writeFormattedMessageToClient(
        player,
        colorize(`The ${npc.name} ${npc.getAttackText('you')} for ${damage} damage.\r\n`, 'red')
      );
      
      // Broadcast to others using RED color for hits
      if (player.user) {
        const username = formatUsername(player.user.username);
        this.broadcastCombatMessage(`The ${npc.name} ${npc.getAttackText(username)} for ${damage} damage.\r\n`, 'red', true);
      }
      
      // Check if player died
      if (player.user.health <= 0) {
        this.handlePlayerDeath();
      }
    } else {
      // Send message to the player
      writeFormattedMessageToClient(
        player,
        colorize(`The ${npc.name} ${npc.getAttackText('you')} and misses!\r\n`, 'cyan')
      );
      
      // Broadcast to others using CYAN color for misses
      if (player.user) {
        const username = formatUsername(player.user.username);
        this.broadcastCombatMessage(`The ${npc.name} ${npc.getAttackText(username)} and misses!\r\n`, 'cyan', true);
      }
    }
  }

  private handleNpcDeath(npc: CombatEntity): void {
    if (!this.player.user) return;
    
    // Award experience to the player
    this.player.user.experience += npc.experienceValue;
    
    // Update the player's experience
    this.userManager.updateUserStats(this.player.user.username, { experience: this.player.user.experience });
    
    // Send death message to the player
    writeFormattedMessageToClient(
      this.player,
      colorize(`The ${npc.name} lets out a final sad meow, and dies.\r\n`, 'magenta')
    );
    
    writeFormattedMessageToClient(
      this.player, 
      colorize(`You gain ${npc.experienceValue} experience!\r\n`, 'bright')
    );
    
    // Broadcast death to others using the default boldYellow for status messages
    if (this.player.user) {
      const username = formatUsername(this.player.user.username);
      this.broadcastCombatMessage(`The ${npc.name} fighting ${username} lets out a final sad meow, and dies.\r\n`, 'magenta', true);
    }
    
    // Remove the NPC from the room
    if (this.player.user.currentRoomId) {
      this.roomManager.removeNPCFromRoom(this.player.user.currentRoomId, npc.name);
    }
    
    // Remove the NPC from active combatants
    this.activeCombatants = this.activeCombatants.filter(c => c !== npc);
  }

  private handlePlayerDeath(): void {
    if (!this.player.user) return;
    
    // Send death message to player
    writeFormattedMessageToClient(
      this.player,
      colorize(`You have been defeated! Use "heal" to recover.\r\n`, 'red')
    );
    
    // Broadcast to others using the default boldYellow for status messages
    if (this.player.user) {
      const username = formatUsername(this.player.user.username);
      this.broadcastCombatMessage(`${username} has been defeated in combat!\r\n`, 'boldYellow', true);
    }
    
    // End combat when player dies
    this.activeCombatants = [];
  }

  isDone(): boolean {
    return this.activeCombatants.length === 0 || 
           this.brokenByPlayer ||
           !this.player.user ||
           this.player.user.health <= 0;
  }

  endCombat(): void {
    if (!this.player.user) return;
    
    // Update the player's combat status
    this.player.user.inCombat = false;
    this.userManager.updateUserStats(this.player.user.username, { inCombat: false });
    
    if (this.activeCombatants.length === 0) {
      // Send message to player
      writeFormattedMessageToClient(
        this.player,
        colorize(`*Combat Off*\r\n`, 'boldYellow')
      );
      
      // Broadcast to others using the default boldYellow for status messages
      if (this.player.user) {
        const username = formatUsername(this.player.user.username);
        this.broadcastCombatMessage(`${username} is no longer in combat.\r\n`, 'boldYellow', true);
      }
    } else if (this.brokenByPlayer) {
      // Send message to player
      writeFormattedMessageToClient(
        this.player,
        colorize(`You try to break combat, but the enemies are still hostile!\r\n`, 'boldYellow')
      );
      
      // Broadcast to others using the default boldYellow for status messages
      if (this.player.user) {
        const username = formatUsername(this.player.user.username);
        this.broadcastCombatMessage(`${username} tries to flee from combat!\r\n`, 'boldYellow', true);
      }
    }
  }

  /**
   * Broadcast combat messages to all players in the room
   */
  private broadcastCombatMessage(message: string, color: ColorType = 'boldYellow', excludePlayer: boolean = false): void {
    if (!this.player.user) return;
    
    const roomId = this.player.user.currentRoomId;
    if (!roomId) return;
    
    // Get the room and all players in it
    const room = this.roomManager.getRoom(roomId);
    if (!room) return;
    
    // Format the message with specified color
    // Don't add extra newlines for observers - the message already should have proper line endings
    const coloredMessage = colorize(message, color);
    
    // Send to all players in the room except possibly the combatant
    for (const playerName of room.players) {
      // Skip the combatant if excludePlayer is true
      if (excludePlayer && this.player.user.username === playerName) continue;
      
      const client = this.findClientByUsername(playerName);
      if (client) {
        writeMessageToClient(client, coloredMessage);
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
}
