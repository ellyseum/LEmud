import { ConnectedClient } from '../types';
import { CombatEntity } from './combatEntity.interface';
import { colorize, ColorType } from '../utils/colors';
import { writeFormattedMessageToClient, drawCommandPrompt, writeToClient } from '../utils/socketWriter';
import { UserManager } from '../user/userManager';
import { RoomManager } from '../room/roomManager';
import { formatUsername } from '../utils/formatters';
import { CombatSystem } from './combatSystem';
import { ItemManager } from '../utils/itemManager';
import { systemLogger, createContextLogger, createMechanicsLogger } from '../utils/logger';

// Create a context-specific logger for Combat
const combatLogger = createMechanicsLogger('Combat');

export class Combat {
  rounds: number = 0;
  activeCombatants: CombatEntity[] = [];
  brokenByPlayer: boolean = false;
  currentRound: number = 0; // Track the current global combat round
  // Add timestamp to track last activity
  lastActivityTime: number = Date.now();
  private itemManager: ItemManager;

  constructor(
    public player: ConnectedClient,
    private userManager: UserManager,
    private roomManager: RoomManager,
    private combatSystem: CombatSystem
  ) {
    this.itemManager = ItemManager.getInstance();
  }

  addTarget(target: CombatEntity): void {
    if (!this.activeCombatants.includes(target)) {
      this.activeCombatants.push(target);
    }
  }

  processRound(): void {
    // First check if the player is still connected and authenticated
    if (!this.isPlayerValid()) {
      combatLogger.info(`Player ${this.player.user?.username || 'unknown'} is no longer valid, ending combat`);
      this.activeCombatants = []; // Clear combatants to end combat
      return;
    }
    
    if (!this.player.user || this.isDone()) {
      combatLogger.debug(`Cannot process round: player user is ${this.player.user ? 'valid' : 'invalid'}, isDone=${this.isDone()}`);
      return;
    }

    // Check if player is still in the correct room with the NPCs
    const playerRoomId = this.player.user.currentRoomId;
    if (!playerRoomId) {
      combatLogger.info(`Player ${this.player.user.username} has no room, ending combat`);
      this.activeCombatants = []; // End combat
      return;
    }

    // Check if any combatants are in a different room
    const invalidCombatants: CombatEntity[] = [];
    
    // Get the room to check for NPCs directly
    const room = this.roomManager.getRoom(playerRoomId);
    if (!room) {
      combatLogger.warn(`Player ${this.player.user.username} is in non-existent room ${playerRoomId}, ending combat`);
      this.activeCombatants = []; // End combat
      return;
    }
    
    for (const combatant of this.activeCombatants) {
      // Check if the NPC is still in the room by name
      if (!room.npcs.has(combatant.name) && !this.isNpcInRoomByTemplateId(room, combatant.name)) {
        combatLogger.debug(`NPC ${combatant.name} is no longer in room ${playerRoomId}`);
        invalidCombatants.push(combatant);
      }
    }
    
    // Remove combatants that are in a different room
    if (invalidCombatants.length > 0) {
      combatLogger.info(`Removing ${invalidCombatants.length} combatants not in the same room as player`);
      this.activeCombatants = this.activeCombatants.filter(
        c => !invalidCombatants.includes(c)
      );
      
      // If no valid combatants remain, end combat
      if (this.activeCombatants.length === 0) {
        combatLogger.info(`No valid combatants remain in player's room, ending combat`);
        return;
      }
    }

    this.rounds++;
    combatLogger.info(`Processing round ${this.rounds} for ${this.player.user.username} against ${this.activeCombatants.length} combatants`);
    
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
      if (this.player.user.inCombat) {
        this.processAttack(this.player, target);
        
        // If target dies from the attack, process death
        if (!target.isAlive()) {
          this.handleNpcDeath(target);
          continue;
        }
      }
      
      // Target counterattacks if not passive - but chooses target randomly among all attackers
      if (!target.isPassive) {
        this.processCounterAttack(target);
      }
    }
    
    // Remove dead combatants
    this.activeCombatants = this.activeCombatants.filter(c => c.isAlive());
    
    // Update the activity timestamp whenever a round is processed
    this.lastActivityTime = Date.now();
  }

  private processAttack(player: ConnectedClient, target: CombatEntity): void {
    if (!player.user || !player.user.currentRoomId) return;
    
    // 50% chance to hit
    const hit = Math.random() >= 0.5;
    
    // Get the room for broadcasting
    const roomId = player.user.currentRoomId;

    // Get the ItemManager for handling weapons and durability
    const itemManager = require('../utils/itemManager').ItemManager.getInstance();
    
    // Check if player has a weapon equipped
    const weaponId = player.user.equipment?.weapon;
    let weaponName = "fists";
    let weaponDamage = 0;
    
    if (weaponId) {
      const displayName = itemManager.getItemDisplayName(weaponId);
      if (displayName) {
        weaponName = displayName;
        
        // Get base damage from the weapon
        const instance = itemManager.getItemInstance(weaponId);
        const template = instance ? itemManager.getItem(instance.templateId) : itemManager.getItem(weaponId);
        
        if (template && template.stats && template.stats.damage) {
          weaponDamage = template.stats.damage;
        }
        
        // Degrade weapon durability with use (only for item instances)
        if (instance && instance.properties?.durability) {
          // 25% chance to degrade durability on hit, 10% on miss
          const degradeChance = hit ? 0.25 : 0.1;
          if (Math.random() < degradeChance) {
            // Degrade by 1 point
            instance.properties.durability.current = Math.max(0, instance.properties.durability.current - 1);
            
            // Check if weapon broke
            if (instance.properties.durability.current === 0) {
              // Weapon broke!
              writeFormattedMessageToClient(
                player,
                colorize(`Your ${weaponName} breaks from excessive use!\r\n`, 'red')
              );
              
              // Broadcast to others
              const username = formatUsername(player.user.username);
              this.combatSystem.broadcastRoomCombatMessage(
                roomId,
                `${username}'s ${weaponName} breaks from excessive use!\r\n`,
                'red' as ColorType,
                player.user.username
              );
              
              // Remove the broken weapon from equipment
              if (player.user.equipment) {
                player.user.equipment.weapon = undefined as unknown as string;
              }
              
              // Set weapon name back to fists for this attack
              weaponName = "fists";
              weaponDamage = 0;
            }
            // Save instance changes
            itemManager.saveItemInstances();
          }
        }
      }
    }
    
    if (hit) {
      // Calculate damage (base damage 5-10 plus weapon damage)
      const baseDamage = Math.floor(Math.random() * 6) + 5;
      const totalDamage = baseDamage + weaponDamage;
      const actualDamage = target.takeDamage(totalDamage);
      
      // Add aggression only when damage is dealt
      target.addAggression(player.user.username, actualDamage);
      
      // Send message to the player
      writeFormattedMessageToClient(
        player,
        colorize(`You hit the ${target.name} with your ${weaponName} for ${actualDamage} damage.\r\n`, 'red')
      );
      
      // Broadcast to ALL other players in room instead of just combat participants
      const username = formatUsername(player.user.username);
      this.combatSystem.broadcastRoomCombatMessage(
        roomId,
        `${username} hits the ${target.name} with their ${weaponName} for ${actualDamage} damage.\r\n`,
        'red' as ColorType,
        player.user.username
      );

      // Reduce weapon durability after a successful hit
      this.reduceWeaponDurability(player);
    } else {
      // Add aggression for a miss (attack attempt)
      target.addAggression(player.user.username, 0);
      
      // Send message to the player
      writeFormattedMessageToClient(
        player,
        colorize(`You swing at the ${target.name} with your ${weaponName}, and miss!\r\n`, 'cyan')
      );
      
      // Broadcast to ALL other players in room
      const username = formatUsername(player.user.username);
      this.combatSystem.broadcastRoomCombatMessage(
        roomId,
        `${username} swings at the ${target.name} with their ${weaponName}, and misses!\r\n`,
        'cyan' as ColorType,
        player.user.username
      );
    }

    // Reduce armor durability after taking damage
    this.reduceArmorDurability(target);
  }

  private reduceWeaponDurability(player: ConnectedClient): void {
    if (!player.user || !player.user.equipment) return;

    const weaponInstanceId = player.user.equipment.weapon;
    if (!weaponInstanceId) return;

    const weaponIntact = this.itemManager.updateDurability(weaponInstanceId, -1);

    if (!weaponIntact) {
      const weaponName = this.itemManager.getItemDisplayName(weaponInstanceId);
      player.user.equipment.weapon = undefined as unknown as string;

      writeFormattedMessageToClient(
        player,
        colorize(`Your ${weaponName} breaks from excessive use!\r\n`, 'red')
      );
    }
  }

  private reduceArmorDurability(target: CombatEntity): void {
    if (!target.isUser()) return;

    const user = this.userManager.getUser(target.getName());
    if (!user || !user.equipment) return;

    const armorSlots = ['head', 'chest', 'arms', 'hands', 'legs', 'feet'];
    const equippedArmorSlots = armorSlots.filter(slot => user.equipment && user.equipment[slot]);

    if (equippedArmorSlots.length === 0) return;

    const randomSlot = equippedArmorSlots[Math.floor(Math.random() * equippedArmorSlots.length)];
    const armorInstanceId = user.equipment[randomSlot];

    if (!armorInstanceId) return;

    const armorIntact = this.itemManager.updateDurability(armorInstanceId, -1);

    if (!armorIntact) {
      const armorName = this.itemManager.getItemDisplayName(armorInstanceId);
      user.equipment[randomSlot] = undefined as unknown as string;

      writeFormattedMessageToClient(
        this.player,
        colorize(`The ${target.name}'s ${armorName} breaks from taking damage!\r\n`, 'red')
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
    let validTarget = false;
    let targetPlayer: ConnectedClient | undefined;
    let attempts = 0;
    const maxAttempts = targetingPlayers.length;
    
    // Try to find a valid target, attempting each player once
    while (!validTarget && attempts < maxAttempts) {
      attempts++;
      const randomIndex = Math.floor(Math.random() * targetingPlayers.length);
      const randomPlayerName = targetingPlayers[randomIndex];
      targetPlayer = this.combatSystem.findClientByUsername(randomPlayerName);
      
      if (targetPlayer && targetPlayer.user && targetPlayer.authenticated) {
        validTarget = true;
      } else if (targetPlayer === undefined || !targetPlayer.authenticated) {
        // If player no longer exists or not authenticated, remove from targeters
        this.combatSystem.removeEntityTargeter(entityId, randomPlayerName);
        // Remove player from the array too to avoid selecting again
        targetingPlayers.splice(randomIndex, 1);
      }
    }
    
    // If no valid target found after checking all players, return
    if (!validTarget || !targetPlayer || !targetPlayer.user) return;
    
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
    const targetingPlayers = [...this.combatSystem.getEntityTargeters(entityId)];
    
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
    
    // Get a custom death message from the NPC
    const deathMessage = `The ${npc.name} ${(npc as any).getDeathMessage?.() || 'collapses to the ground and dies'}.\r\n`;
    
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
        `The ${npc.name} fighting ${killerUsername} ${(npc as any).getDeathMessage?.() || 'collapses to the ground and dies'}.\r\n`,
        'magenta',
        this.player.user.username
      );
    }
    
    // NEW: Remove the entity from active combat in the room
    this.combatSystem['removeEntityFromCombatForRoom'](roomId, npc.name);
    
    // Clear aggression from the dead entity
    npc.clearAllAggression();
    
    // End combat for all players who were targeting this entity
    // This ensures all players receive the Combat Off message
    for (const playerName of targetingPlayers) {
      // Skip processing for invalid players (already disconnected)
      const client = this.combatSystem.findClientByUsername(playerName);
      if (!client || !client.user) continue;
      
      // Only process combat end for players other than the one who landed the killing blow
      // (the player who killed it has their combat ended separately)
      if (playerName !== this.player.user.username) {
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
    
    // Remove the NPC from the room
    // FIXED: Use instanceId instead of name for removing NPC from room
    if ((npc as any).instanceId) {
      combatLogger.info(`Removing NPC with instanceId ${(npc as any).instanceId} from room ${roomId}`);
      this.roomManager.removeNPCFromRoom(roomId, (npc as any).instanceId);
    } else {
      combatLogger.warn(`Cannot remove NPC ${npc.name} from room: no instanceId available`);
      // Fallback to using name, though this likely won't work with the new Map implementation
      this.roomManager.removeNPCFromRoom(roomId, npc.name);
    }
    
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

  public isDone(): boolean {
    // Remove or change the “brokenByPlayer” check so the enemy can still attack.
    // For example, simply remove `|| this.brokenByPlayer`:
    const allDead = this.activeCombatants.every(c => !c.isAlive());
    return allDead ||
           /* this.brokenByPlayer || */  // <-- Remove this to allow combat to continue
           !this.player.user ||
           this.player.user.health <= 0;
  }

  endCombat(playerFled: boolean = false): void {
    if (!this.player.user) return;
    
    // Check if the player is already out of combat
    const wasInCombat = this.player.user.inCombat;
    
    // Update the player's combat status
    this.player.user.inCombat = false;
    this.userManager.updateUserStats(this.player.user.username, { inCombat: false });
    
    // Only show combat off message if the player was actually in combat
    if (wasInCombat && (this.activeCombatants.length === 0 || playerFled)) {
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
    // Special case: Consider valid during transfers regardless of other checks
    // CRITICAL FIX: More aggressive client reference updating
    if (this.player && this.player.stateData && 
       (this.player.stateData.transferInProgress || this.player.stateData.isSessionTransfer)) {
      combatLogger.debug(`Session transfer in progress for player, considering valid`);
      return true;
    }
    
    // Case where player reference is completely broken
    if (!this.player || !this.player.user) {
      combatLogger.debug(`Player is invalid: null player or user`);
      
      // Add an additional 5-second grace period for lost references during transfers
      const currentTime = Date.now();
      if (this.lastActivityTime && currentTime - this.lastActivityTime < 5000) {
        combatLogger.debug(`Within grace period (${currentTime - this.lastActivityTime}ms), temporarily considering valid`);
        return true;
      }
      
      return false;
    }
    
    const username = this.player.user.username;
    // Find by username - more reliable than checking specific client
    // This handles the case where client reference changed but username is the same
    const allClients = this.combatSystem.findAllClientsByUsername(username);
    if (allClients.length > 0) {
      // Use the first connected client with this username
      const newClient = allClients[0];
      // Don't log if it's the same client to reduce noise
      if (newClient !== this.player) {
        combatLogger.info(`Updating player reference from ${this.player.id || 'unknown'} to ${newClient.id || 'unknown'}`);
        this.player = newClient;
      }
      return true;
    }
    
    combatLogger.warn(`No valid clients found for ${username}, marking invalid`);
    return false;
  }
  
  /**
   * Update the client reference when a session transfer happens
   * This ensures combat continues with the new client
   */
  public updateClientReference(newClient: ConnectedClient): void {
    if (!newClient.user) return;
    
    // Only update if this is the same user
    if (this.player.user && newClient.user.username === this.player.user.username) {
      const oldClientId = this.player.id || 'unknown';
      const newClientId = newClient.id || 'unknown';
      combatLogger.info(`Updating client reference for ${newClient.user.username} from ${oldClientId} to ${newClientId}`);
      
      // CRITICAL: Make sure we preserve the combat state if needed
      const hadActiveCombatants = this.activeCombatants.length > 0;
      const activeCombatantsCopy = [...this.activeCombatants];
      
      // Add a stronger reference binding to prevent GC issues
      newClient.stateData.combatInstance = this;
      
      // Simply update the reference
      this.player = newClient;
      
      // Make sure the combat flag is set
      if (newClient.user) {
        newClient.user.inCombat = true;
      }
      
      // Handle case where active combatants might be lost during transfer
      if (hadActiveCombatants && this.activeCombatants.length === 0) {
        combatLogger.info(`Restoring ${activeCombatantsCopy.length} combatants that were lost in transfer`);
        this.activeCombatants = activeCombatantsCopy;
      }
      
      // Update the activity timestamp
      this.lastActivityTime = Date.now();
      
      // Log combat status
      combatLogger.debug(`After update, player.user.inCombat = ${newClient.user.inCombat}`);
      combatLogger.debug(`Active combatants after update: ${this.activeCombatants.length}`);
    } else {
      if (!this.player.user) {
        combatLogger.warn(`Cannot update client reference: player has no user property`);
      } else {
        combatLogger.warn(`Username mismatch: expected ${this.player.user.username}, got ${newClient.user.username}`);
      }
    }
  }

  /**
   * Helper method to check if an NPC with a specific template ID exists in a room
   */
  private isNpcInRoomByTemplateId(room: any, templateId: string): boolean {
    const npcs = Array.from(room.npcs.values()) as any[];
    return npcs.some(npc => npc.templateId === templateId);
  }
}
