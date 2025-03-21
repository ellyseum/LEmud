import { ConnectedClient } from '../types';
import { CombatEntity } from './combatEntity.interface';
import { colorize, ColorType } from '../utils/colors';
import { writeFormattedMessageToClient, drawCommandPrompt, writeToClient } from '../utils/socketWriter';
import { UserManager } from '../user/userManager';
import { RoomManager } from '../room/roomManager';
import { formatUsername } from '../utils/formatters';
import { CombatSystem } from './combatSystem';

export class Combat {
  rounds: number = 0;
  activeCombatants: CombatEntity[] = [];
  brokenByPlayer: boolean = false;
  currentRound: number = 0; // Track the current global combat round
  
  constructor(
    public player: ConnectedClient,
    private userManager: UserManager,
    private roomManager: RoomManager,
    private combatSystem: CombatSystem
  ) {}

  addTarget(target: CombatEntity): void {
    if (!this.activeCombatants.includes(target)) {
      this.activeCombatants.push(target);
    }
  }

  processRound(): void {
    // First check if the player is still connected and authenticated
    if (!this.isPlayerValid()) {
      this.activeCombatants = []; // Clear combatants to end combat
      return;
    }
    
    if (!this.player.user || this.isDone()) return;

    this.rounds++;
    
    // Process each combatant
    for (let i = 0; i < this.activeCombatants.length; i++) {
      const target = this.activeCombatants[i];
      
      // Check if target is already dead (killed by another player)
      if (!target.isAlive()) {
        // Don't process death again, just remove from active combatants
        this.activeCombatants = this.activeCombatants.filter(c => c !== target);
        continue;
      }
      
      // Player attacks target
      this.processAttack(this.player, target);
      
      // If target dies from the attack, process death
      if (!target.isAlive()) {
        this.handleNpcDeath(target);
        continue;
      }
      
      // Target counterattacks if not passive - but chooses target randomly among all attackers
      if (!target.isPassive) {
        this.processCounterAttack(target);
      }
    }
    
    // Remove dead combatants
    this.activeCombatants = this.activeCombatants.filter(c => c.isAlive());
  }

  private processAttack(player: ConnectedClient, target: CombatEntity): void {
    if (!player.user || !player.user.currentRoomId) return;
    
    // 50% chance to hit
    const hit = Math.random() >= 0.5;
    
    // Get the room for broadcasting
    const roomId = player.user.currentRoomId;
    
    if (hit) {
      // Calculate damage (temporary range of 5-10)
      const damage = Math.floor(Math.random() * 6) + 5;
      const actualDamage = target.takeDamage(damage);
      
      // Send message to the player
      writeFormattedMessageToClient(
        player,
        colorize(`You hit the ${target.name} with your fists for ${actualDamage} damage.\r\n`, 'red')
      );
      
      // Broadcast to ALL other players in room instead of just combat participants
      const username = formatUsername(player.user.username);
      this.combatSystem.broadcastRoomCombatMessage(
        roomId,
        `${username} hits the ${target.name} with their fists for ${actualDamage} damage.\r\n`,
        'red' as ColorType,
        player.user.username
      );
    } else {
      // Send message to the player
      writeFormattedMessageToClient(
        player,
        colorize(`You swing at the ${target.name} with your fists, and miss!\r\n`, 'cyan')
      );
      
      // Broadcast to ALL other players in room
      const username = formatUsername(player.user.username);
      this.combatSystem.broadcastRoomCombatMessage(
        roomId,
        `${username} swings at the ${target.name} with their fists, and misses!\r\n`,
        'cyan' as ColorType,
        player.user.username
      );
    }
  }

  private processCounterAttack(npc: CombatEntity): void {
    if (!this.player.user || !this.player.user.currentRoomId) return;
    
    // Get the entity ID
    const entityId = this.combatSystem.getEntityId(this.player.user.currentRoomId, npc.name);
    
    // Check if this entity has already attacked in this round
    if (this.combatSystem.hasEntityAttackedThisRound(entityId)) {
      return; // Skip attack if entity already attacked this round
    }
    
    // Get all players targeting this entity
    const targetingPlayers = this.combatSystem.getEntityTargeters(entityId);
    if (targetingPlayers.length === 0) return;
    
    // Choose a random player to attack
    const randomPlayerName = targetingPlayers[Math.floor(Math.random() * targetingPlayers.length)];
    const targetPlayer = this.combatSystem.findClientByUsername(randomPlayerName);
    
    if (!targetPlayer || !targetPlayer.user) return;
    
    // Mark that this entity has attacked in this round
    this.combatSystem.markEntityAttacked(entityId);
    
    // 50% chance to hit
    const hit = Math.random() >= 0.5;
    
    // Get the room for broadcasting
    const roomId = this.player.user.currentRoomId;
    
    if (hit) {
      const damage = npc.getAttackDamage();
      targetPlayer.user.health -= damage;
      
      // Ensure health doesn't go below 0
      if (targetPlayer.user.health < 0) targetPlayer.user.health = 0;
      
      // Update the player's health
      this.userManager.updateUserStats(targetPlayer.user.username, { health: targetPlayer.user.health });
      
      // Format the target name for messages
      const targetNameFormatted = formatUsername(targetPlayer.user.username);
      
      // Send message to the targeted player
      writeFormattedMessageToClient(
        targetPlayer,
        colorize(`The ${npc.name} ${npc.getAttackText('you')} for ${damage} damage.\r\n`, 'red')
      );
      
      // Broadcast to ALL players in room except the target
      this.combatSystem.broadcastRoomCombatMessage(
        roomId,
        `The ${npc.name} ${npc.getAttackText(targetNameFormatted)} for ${damage} damage.\r\n`,
        'red' as ColorType,
        targetPlayer.user.username
      );
      
      // Check if player died
      if (targetPlayer.user.health <= 0) {
        this.handlePlayerDeath(targetPlayer);
      }
    } else {
      // Format the target name for messages
      const targetNameFormatted = formatUsername(targetPlayer.user.username);
      
      // Send message to the targeted player
      writeFormattedMessageToClient(
        targetPlayer,
        colorize(`The ${npc.name} ${npc.getAttackText('you')} and misses!\r\n`, 'cyan')
      );
      
      // Broadcast to ALL players in room except the target
      this.combatSystem.broadcastRoomCombatMessage(
        roomId,
        `The ${npc.name} ${npc.getAttackText(targetNameFormatted)} and misses!\r\n`,
        'cyan' as ColorType,
        targetPlayer.user.username
      );
    }
  }

  private handleNpcDeath(npc: CombatEntity): void {
    if (!this.player.user || !this.player.user.currentRoomId) return;
    
    const roomId = this.player.user.currentRoomId;
    
    // Get the entity ID
    const entityId = this.combatSystem.getEntityId(roomId, npc.name);
    
    // Get all players targeting this entity
    const targetingPlayers = this.combatSystem.getEntityTargeters(entityId);
    
    // Calculate experience per player - divide the total experience by number of participants
    const experiencePerPlayer = Math.floor(npc.experienceValue / targetingPlayers.length);
    
    // Award experience to all participating players
    for (const playerName of targetingPlayers) {
      const client = this.combatSystem.findClientByUsername(playerName);
      if (client && client.user) {
        // Award experience to this player
        client.user.experience += experiencePerPlayer;
        
        // Update the player's experience
        this.userManager.updateUserStats(client.user.username, { experience: client.user.experience });
        
        // Notify the player about experience gained
        writeFormattedMessageToClient(
          client,
          colorize(`You gain ${experiencePerPlayer} experience from the ${npc.name}!\r\n`, 'bright')
        );
      }
    }
    
    // Send death message to all players in the room
    const deathMessage = `The ${npc.name} lets out a final sad meow, and dies.\r\n`;
    
    // For main killer (the one whose combat instance is processing this death)
    writeFormattedMessageToClient(
      this.player,
      colorize(deathMessage, 'magenta')
    );
    
    // Broadcast to everyone else in the room
    if (this.player.user) {
      const killerUsername = formatUsername(this.player.user.username);
      this.combatSystem.broadcastRoomCombatMessage(
        roomId,
        `The ${npc.name} fighting ${killerUsername} lets out a final sad meow, and dies.\r\n`,
        'magenta',
        this.player.user.username
      );
    }
    
    // End combat for all players who were targeting this entity
    // This ensures all players receive the Combat Off message
    for (const playerName of targetingPlayers) {
      if (playerName !== this.player.user.username) { // Skip the player who landed the killing blow (handled in endCombat)
        const client = this.combatSystem.findClientByUsername(playerName);
        if (client && client.user) {
          // Set inCombat to false
          client.user.inCombat = false;
          this.userManager.updateUserStats(client.user.username, { inCombat: false });
          
          // Clear the line first
          const clearLineSequence = '\r\x1B[K';
          writeToClient(client, clearLineSequence);
          
          // Send Combat Off message
          writeToClient(
            client,
            colorize(`*Combat Off*\r\n`, 'boldYellow')
          );
          
          // Draw the prompt explicitly once
          drawCommandPrompt(client);
          
          // Remove from combat system
          this.combatSystem.removeCombatForPlayer(playerName);
        }
      }
    }
    
    // Remove the NPC from the room
    this.roomManager.removeNPCFromRoom(roomId, npc.name);
    
    // Clean up the shared entity reference
    this.combatSystem.cleanupDeadEntity(roomId, npc.name);
    
    // Remove all players from targeting this entity
    for (const playerName of targetingPlayers) {
      this.combatSystem.removeEntityTargeter(entityId, playerName);
    }
    
    // Remove the NPC from active combatants
    this.activeCombatants = this.activeCombatants.filter(c => c !== npc);
  }

  private handlePlayerDeath(targetPlayer: ConnectedClient): void {
    if (!targetPlayer.user) return;
    
    // Send death message to player
    writeFormattedMessageToClient(
      targetPlayer,
      colorize(`You have been defeated! Use "heal" to recover.\r\n`, 'red')
    );
    
    // Broadcast to others using the default boldYellow for status messages
    const username = formatUsername(targetPlayer.user.username);
    const message = `${username} has been defeated in combat!\r\n`;
    
    // If this player died, end combat for them
    if (targetPlayer === this.player) {
      this.activeCombatants = [];
    }
    
    // Broadcast to all other players in the room
    if (targetPlayer.user.currentRoomId) {
      const room = this.roomManager.getRoom(targetPlayer.user.currentRoomId);
      if (room) {
        for (const playerName of room.players) {
          if (playerName !== targetPlayer.user.username) {
            const client = this.combatSystem.findClientByUsername(playerName);
            if (client) {
              writeFormattedMessageToClient(client, colorize(message, 'boldYellow'));
            }
          }
        }
      }
    }
  }

  isDone(): boolean {
    // End combat if player is no longer valid
    if (!this.isPlayerValid()) {
      return true;
    }
    
    // Only end combat if we truly have no active combatants
    if (this.activeCombatants.length === 0) {
      return true;
    }
    
    // Check if all combatants are dead
    const allDead = this.activeCombatants.every(c => !c.isAlive());
    
    return allDead || 
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
      // Clear the line first
      const clearLineSequence = '\r\x1B[K';
      writeToClient(this.player, clearLineSequence);
      
      // Send message to player without drawing prompt yet
      writeToClient(
        this.player,
        colorize(`*Combat Off*\r\n`, 'boldYellow')
      );
      
      // Now draw the prompt explicitly once
      drawCommandPrompt(this.player);
      
      // Broadcast to ALL players in the room
      if (this.player.user && this.player.user.currentRoomId) {
        const username = formatUsername(this.player.user.username);
        this.combatSystem.broadcastRoomCombatMessage(
          this.player.user.currentRoomId,
          `${username} is no longer in combat.\r\n`,
          'boldYellow' as ColorType,
          this.player.user.username
        );
      }
    } else if (this.brokenByPlayer) {
      // Clear the line first
      const clearLineSequence = '\r\x1B[K';
      writeToClient(this.player, clearLineSequence);
      
      // Send message to player without drawing prompt yet
      writeToClient(
        this.player,
        colorize(`You try to break combat, but the enemies are still hostile!\r\n`, 'boldYellow')
      );
      
      // Now draw the prompt explicitly once
      drawCommandPrompt(this.player);
      
      // Broadcast to others using the default boldYellow for status messages
      if (this.player.user) {
        const username = formatUsername(this.player.user.username);
        this.combatSystem.broadcastRoomCombatMessage(
          this.player.user.currentRoomId,
          `${username} tries to flee from combat!\r\n`,
          'boldYellow' as ColorType,
          this.player.user.username
        );
      }
    }
  }
  
  /**
   * Check if the player is still valid (connected and authenticated)
   */
  private isPlayerValid(): boolean {
    // Check if the player is still in the clients map
    const client = this.combatSystem.findClientByUsername(this.player.user?.username || '');
    if (!client || !client.user || !client.authenticated) {
      return false;
    }
    
    // Check if the player's state matches
    if (client !== this.player) {
      // Update the player reference if needed
      this.player = client;
    }
    
    return true;
  }
}
