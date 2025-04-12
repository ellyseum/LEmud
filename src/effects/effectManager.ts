// filepath: /Users/jelden/projects/game/src/effects/effectManager.ts
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { UserManager } from '../user/userManager';
import { RoomManager } from '../room/roomManager';
import { 
    ActiveEffect, 
    EffectPayload, 
    EffectType, 
    StackingBehavior, 
    effectStackingRules 
} from '../types/effects';
import { writeFormattedMessageToClient } from '../utils/socketWriter';
import { CombatSystem } from '../combat/combatSystem';
import { ConnectedClient } from '../types';

/**
 * EffectManager
 * Manages temporary effects on players and NPCs, handling timers, stacking
 * and effect processing.
 */
export class EffectManager extends EventEmitter {
    private static instance: EffectManager | null = null;
    private playerEffects: Map<string, ActiveEffect[]> = new Map();
    private npcEffects: Map<string, ActiveEffect[]> = new Map();

    private userManager: UserManager;
    private roomManager: RoomManager;
    private combatSystem: CombatSystem;

    private realTimeProcessorIntervalId: NodeJS.Timeout | null = null;
    private readonly REAL_TIME_CHECK_INTERVAL_MS = 250; // Check time-based effects every 250ms

    /**
     * Private constructor - use getInstance() instead
     */
    private constructor(userManager: UserManager, roomManager: RoomManager) {
        super();
        console.log('Creating EffectManager instance');
        this.userManager = userManager;
        this.roomManager = roomManager;
        this.combatSystem = CombatSystem.getInstance(userManager, roomManager);
        this.startRealTimeProcessor();
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(userManager: UserManager, roomManager: RoomManager): EffectManager {
        if (!EffectManager.instance) {
            EffectManager.instance = new EffectManager(userManager, roomManager);
        } else {
            // Update references if needed
            EffectManager.instance.userManager = userManager;
            EffectManager.instance.roomManager = roomManager;
        }
        return EffectManager.instance;
    }

    /**
     * Reset the singleton instance (primarily for testing)
     */
    public static resetInstance(): void {
        if (EffectManager.instance && EffectManager.instance.realTimeProcessorIntervalId) {
            EffectManager.instance.stopRealTimeProcessor();
        }
        EffectManager.instance = null;
    }

    /**
     * Start the real-time processor to handle time-based effects
     */
    private startRealTimeProcessor(): void {
        if (this.realTimeProcessorIntervalId) return; // Already running
        
        console.log(`[EffectManager] Starting real-time effect processor (interval: ${this.REAL_TIME_CHECK_INTERVAL_MS}ms)`);
        this.realTimeProcessorIntervalId = setInterval(() => {
            this.processRealTimeEffects();
        }, this.REAL_TIME_CHECK_INTERVAL_MS);
    }

    /**
     * Stop the real-time processor (for shutdown)
     */
    public stopRealTimeProcessor(): void {
        if (this.realTimeProcessorIntervalId) {
            console.log("[EffectManager] Stopping real-time effect processor.");
            clearInterval(this.realTimeProcessorIntervalId);
            this.realTimeProcessorIntervalId = null;
        }
    }

    /**
     * Add a new effect to a target (player or NPC)
     */
    public addEffect(
        targetId: string, 
        isPlayer: boolean, 
        effectData: Omit<ActiveEffect, 'id' | 'remainingTicks' | 'lastTickApplied' | 'lastRealTimeApplied'>
    ): void {
        console.log(`[EffectManager] Adding effect: ${effectData.type} to ${targetId}`);
        console.log(`[EffectManager] Effect details: durationTicks=${effectData.durationTicks}, tickInterval=${effectData.tickInterval}, damagePerTick=${effectData.payload.damagePerTick}`);

        const targetMap = isPlayer ? this.playerEffects : this.npcEffects;
        const existingEffects = targetMap.get(targetId) || [];
        
        // Use the effect's specified stacking behavior or the default for its type
        const stackingBehavior = effectData.stackingBehavior ?? 
            effectStackingRules[effectData.type] ?? 
            StackingBehavior.REFRESH;

        // Create the new effect with a unique ID
        let effectToAdd: ActiveEffect | null = {
            ...effectData,
            id: uuidv4(),
            remainingTicks: effectData.durationTicks,
            isTimeBased: effectData.isTimeBased ?? false,
            // Initialize lastTickApplied to current tick from GameTimerManager instead of -1
            // This ensures effect applies on the next tick rather than immediately
            lastTickApplied: this.getGameTimerTickCount(),
            lastRealTimeApplied: effectData.isTimeBased ? Date.now() : undefined,
        };

        // Find existing effects of the same type
        const sameTypeEffects = existingEffects.filter(e => e.type === effectData.type);
        const effectsToRemove: string[] = [];
        let updatedEffects = [...existingEffects];

        // Apply stacking rules if effects of the same type exist
        if (sameTypeEffects.length > 0) {
            switch (stackingBehavior) {
                case StackingBehavior.REPLACE:
                case StackingBehavior.REFRESH:
                    // Remove all existing effects of this type
                    sameTypeEffects.forEach(e => effectsToRemove.push(e.id));
                    console.log(`[EffectManager] Replacing/Refreshing effect type ${effectData.type} on ${targetId}`);
                    break;

                case StackingBehavior.STACK_DURATION:
                    // Add duration to the first existing effect
                    if (sameTypeEffects[0]) {
                        sameTypeEffects[0].remainingTicks += effectData.durationTicks;
                        console.log(`[EffectManager] Stacking duration for effect ${sameTypeEffects[0].id} (${effectData.type}) on ${targetId}. New duration: ${sameTypeEffects[0].remainingTicks}`);
                        effectToAdd = null; // Don't add a new instance
                    }
                    break;

                case StackingBehavior.STACK_INTENSITY:
                    // Do nothing special - both effects will exist and apply independently
                    console.log(`[EffectManager] Stacking intensity for effect type ${effectData.type} on ${targetId}`);
                    break;

                case StackingBehavior.STRONGEST_WINS:
                    // Simple implementation: just check damagePerTick or healPerTick
                    const existingStrength = sameTypeEffects.reduce((max, e) => {
                        const damageStrength = e.payload.damagePerTick ?? e.payload.damageAmount ?? 0;
                        const healStrength = e.payload.healPerTick ?? e.payload.healAmount ?? 0;
                        return Math.max(max, damageStrength, healStrength);
                    }, 0);

                    const newDamageStrength = effectData.payload.damagePerTick ?? effectData.payload.damageAmount ?? 0;
                    const newHealStrength = effectData.payload.healPerTick ?? effectData.payload.healAmount ?? 0;
                    const newStrength = Math.max(newDamageStrength, newHealStrength);

                    if (newStrength > existingStrength) {
                        // New effect is stronger, remove all existing ones
                        sameTypeEffects.forEach(e => effectsToRemove.push(e.id));
                        console.log(`[EffectManager] New effect ${effectData.type} is stronger, replacing existing on ${targetId}`);
                    } else {
                        // Existing is stronger, ignore the new one
                        console.log(`[EffectManager] Existing effect ${effectData.type} is stronger, ignoring new one on ${targetId}`);
                        effectToAdd = null;
                    }
                    break;

                case StackingBehavior.IGNORE:
                    // Ignore new effect if same type exists
                    console.log(`[EffectManager] Ignoring new effect ${effectData.type} because one already exists on ${targetId}`);
                    effectToAdd = null;
                    break;
            }
        }

        // Remove marked effects
        if (effectsToRemove.length > 0) {
            updatedEffects = updatedEffects.filter(e => !effectsToRemove.includes(e.id));
        }

        // Add the new effect if not nullified by stacking rules
        if (effectToAdd) {
            updatedEffects.push(effectToAdd);
            console.log(`[EffectManager] Applied effect ${effectToAdd.name} (${effectToAdd.id}) to ${targetId}`);
            
            // Notify the target if it's a player
            if (isPlayer) {
                const client = this.userManager.getActiveUserSession(targetId);
                if (client) {
                    writeFormattedMessageToClient(
                        client, 
                        `\r\n\x1b[1;36mYou are affected by ${effectToAdd.name}: ${effectToAdd.description}\x1b[0m\r\n`
                    );
                }
            }
        }

        // Update the map
        targetMap.set(targetId, updatedEffects);

        // Emit event for external systems to react to
        this.emit('effectAdded', { targetId, isPlayer, effect: effectToAdd });
    }

    /**
     * Get the current tick count from GameTimerManager
     */
    private getGameTimerTickCount(): number {
        try {
            // Access the GameTimerManager via a dynamic import to avoid circular dependencies
            const { GameTimerManager } = require('../timer/gameTimerManager');
            // Get manager instance from existing singletons to avoid creating new instances
            const gameTimerManager = GameTimerManager.getInstance(this.userManager, this.roomManager);
            return gameTimerManager.getTickCount();
        } catch (err) {
            console.error('[EffectManager] Error getting GameTimerManager tick count:', err);
            return 0; // Default to 0 if can't get the real tick count
        }
    }

    /**
     * Remove an effect by its ID
     */
    public removeEffect(effectId: string): void {
        let found = false;
        let removedEffect: ActiveEffect | null = null;
        let targetId: string = '';
        let isPlayer: boolean = false;

        // First check player effects
        for (const [username, effects] of this.playerEffects.entries()) {
            const effectToRemove = effects.find(e => e.id === effectId);
            if (effectToRemove) {
                const filteredEffects = effects.filter(e => e.id !== effectId);
                removedEffect = effectToRemove;
                targetId = username;
                isPlayer = true;

                if (filteredEffects.length > 0) {
                    this.playerEffects.set(username, filteredEffects);
                } else {
                    this.playerEffects.delete(username);
                }
                
                found = true;
                console.log(`[EffectManager] Removed effect ${effectId} from player ${username}`);
                
                // Notify the player
                const client = this.userManager.getActiveUserSession(username);
                if (client) {
                    writeFormattedMessageToClient(
                        client,
                        `\r\n\x1b[1;33mThe effect ${effectToRemove.name} has worn off.\x1b[0m\r\n`
                    );
                }
                
                break;
            }
        }

        // If not found, check NPC effects
        if (!found) {
            for (const [npcId, effects] of this.npcEffects.entries()) {
                const effectToRemove = effects.find(e => e.id === effectId);
                if (effectToRemove) {
                    removedEffect = effectToRemove;
                    targetId = npcId;
                    isPlayer = false;
                    
                    const filteredEffects = effects.filter(e => e.id !== effectId);
                    if (filteredEffects.length > 0) {
                        this.npcEffects.set(npcId, filteredEffects);
                    } else {
                        this.npcEffects.delete(npcId);
                    }
                    
                    console.log(`[EffectManager] Removed effect ${effectId} from NPC ${npcId}`);
                    break;
                }
            }
        }

        // Emit event for external systems to react to
        if (removedEffect) {
            this.emit('effectRemoved', { targetId, isPlayer, effect: removedEffect });
        }
    }

    /**
     * Get all active effects for a target
     */
    public getEffectsForTarget(targetId: string, isPlayer: boolean): ActiveEffect[] {
        const targetMap = isPlayer ? this.playerEffects : this.npcEffects;
        return targetMap.get(targetId) || [];
    }

    /**
     * Calculate combined stat modifiers for a target
     */
    public getStatModifiers(targetId: string, isPlayer: boolean): { [stat: string]: number } {
        const effects = this.getEffectsForTarget(targetId, isPlayer);
        const combinedModifiers: { [stat: string]: number } = {};

        for (const effect of effects) {
            if (effect.payload.statModifiers) {
                for (const [stat, value] of Object.entries(effect.payload.statModifiers)) {
                    combinedModifiers[stat] = (combinedModifiers[stat] || 0) + value;
                }
            }
        }
        
        return combinedModifiers;
    }

    /**
     * Check if a specific action is blocked for a target
     */
    public isActionBlocked(targetId: string, isPlayer: boolean, action: 'movement' | 'combat'): boolean {
        const effects = this.getEffectsForTarget(targetId, isPlayer);
        
        for (const effect of effects) {
            if (action === 'movement' && effect.payload.blockMovement) return true;
            if (action === 'combat' && effect.payload.blockCombat) return true;
        }
        
        return false;
    }

    /**
     * Process game tick for all tick-based effects
     */
    public processGameTick(currentTick: number): void {
        const effectsToRemove: string[] = [];
        console.log(`[EffectManager] Processing game tick ${currentTick} for effects`);
        console.log(`[EffectManager] Player effects: ${this.playerEffects.size}, NPC effects: ${this.npcEffects.size}`);

        // Helper to process effects for a target
        const processTargetEffects = (targetId: string, effects: ActiveEffect[], isPlayer: boolean) => {
            console.log(`[EffectManager] Processing ${effects.length} effects for ${isPlayer ? 'player' : 'NPC'} ${targetId}`);
            
            for (const effect of effects) {
                // Decrement remaining duration for ALL effects
                effect.remainingTicks--;
                console.log(`[EffectManager] Effect ${effect.type} (${effect.id}) has ${effect.remainingTicks} ticks remaining`);

                // Check if effect has expired
                if (effect.remainingTicks <= 0) {
                    console.log(`[EffectManager] Effect ${effect.type} (${effect.id}) has expired, queuing for removal`);
                    effectsToRemove.push(effect.id);
                    continue;
                }

                // Only process tick-based periodic effects here
                if (!effect.isTimeBased && effect.tickInterval > 0 && 
                    (currentTick - effect.lastTickApplied) >= effect.tickInterval) {
                    console.log(`[EffectManager] Applying tick-based effect ${effect.type} (${effect.id}) to ${targetId}`);
                    effect.lastTickApplied = currentTick;
                    this.applyEffectPayload(effect, targetId, isPlayer);
                } else {
                    console.log(`[EffectManager] Skipping effect ${effect.type} (${effect.id}) - not ready to tick yet`);
                    console.log(`[EffectManager] isTimeBased=${effect.isTimeBased}, tickInterval=${effect.tickInterval}, lastTick=${effect.lastTickApplied}, diff=${currentTick - effect.lastTickApplied}`);
                }
            }
        };

        // Process player effects
        this.playerEffects.forEach((effects, username) => {
            processTargetEffects(username, effects, true);
        });

        // Process NPC effects
        this.npcEffects.forEach((effects, npcId) => {
            processTargetEffects(npcId, effects, false);
        });

        // Remove expired effects
        if (effectsToRemove.length > 0) {
            console.log(`[EffectManager] Removing ${effectsToRemove.length} expired effects`);
            effectsToRemove.forEach(id => this.removeEffect(id));
        }
    }

    /**
     * Process time-based effects based on real-time intervals
     */
    private processRealTimeEffects(): void {
        const now = Date.now();

        // Helper to process time-based effects for a target
        const processTargetTimeEffects = (targetId: string, effects: ActiveEffect[], isPlayer: boolean) => {
            for (const effect of effects) {
                // Only process time-based effects
                if (effect.isTimeBased && effect.realTimeIntervalMs && effect.lastRealTimeApplied && 
                    (now - effect.lastRealTimeApplied >= effect.realTimeIntervalMs)) {
                    
                    // Only apply if effect hasn't expired
                    if (effect.remainingTicks > 0) {
                        effect.lastRealTimeApplied = now;
                        this.applyEffectPayload(effect, targetId, isPlayer);
                    }
                }
            }
        };

        // Process player time-based effects
        this.playerEffects.forEach((effects, username) => {
            processTargetTimeEffects(username, effects, true);
        });

        // Process NPC time-based effects
        this.npcEffects.forEach((effects, npcId) => {
            processTargetTimeEffects(npcId, effects, false);
        });
    }

    /**
     * Apply an effect's payload (damage, healing, etc.)
     */
    private applyEffectPayload(effect: ActiveEffect, targetId: string, isPlayer: boolean): void {
        // Extract damage and healing amounts
        const damageAmount = effect.payload.damagePerTick ?? effect.payload.damageAmount ?? 0;
        const healAmount = effect.payload.healPerTick ?? effect.payload.healAmount ?? 0;

        if (isPlayer) {
            // Handle player effects
            const client = this.userManager.getActiveUserSession(targetId);
            if (!client || !client.user) return;

            let message = "";

            // Apply damage
            if (damageAmount > 0) {
                const oldHealth = client.user.health;
                const newHealth = Math.max(oldHealth - damageAmount, -10); // Game's unconscious threshold
                client.user.health = newHealth;
                this.userManager.updateUserStats(targetId, { health: newHealth });
                
                message += `\r\n\x1b[1;31mYou take ${damageAmount} damage from ${effect.name}.\x1b[0m `;
                
                // Notify everyone in the room about the player taking damage
                this.notifyRoom(targetId, `${client.user.username} takes ${damageAmount} damage from ${effect.name}.`, client.user.username);
                
                // Check for unconsciousness or death
                if (newHealth <= 0 && oldHealth > 0) {
                    client.user.isUnconscious = true;
                    message += `\r\n\x1b[1;31mYou fall unconscious!\x1b[0m `;
                    
                    // Notify room
                    this.notifyRoom(targetId, `${client.user.username} falls unconscious!`);
                }
                
                // Check for death at -10 HP
                if (newHealth <= -10) {
                    message += `\r\n\x1b[1;31mYou have died!\x1b[0m `;
                    
                    // Handle player death (similar to CombatSystem)
                    this.handlePlayerDeath(client);
                }
            }

            // Apply healing
            if (healAmount > 0) {
                const oldHealth = client.user.health;
                const maxHealth = client.user.maxHealth;
                const newHealth = Math.min(oldHealth + healAmount, maxHealth);
                client.user.health = newHealth;
                this.userManager.updateUserStats(targetId, { health: newHealth });
                
                message += `\r\n\x1b[1;32mYou gain ${healAmount} health from ${effect.name}.\x1b[0m `;
                
                // Notify everyone in the room about healing
                this.notifyRoom(targetId, `${client.user.username} gains ${healAmount} health from ${effect.name}.`, client.user.username);
                
                // Check for regaining consciousness
                if (newHealth > 0 && oldHealth <= 0) {
                    client.user.isUnconscious = false;
                    message += `\r\n\x1b[1;32mYou regain consciousness!\x1b[0m `;
                    
                    // Notify room
                    this.notifyRoom(targetId, `${client.user.username} regains consciousness!`);
                }
            }

            // Send message to player
            if (message && client.connection) {
                writeFormattedMessageToClient(client, message);
            }

        } else {
            // Handle NPC effects
            const npc = this.findNpcById(targetId);
            if (!npc) return;

            // Get the room the NPC is in
            const roomId = this.findRoomForNpc(targetId);
            if (!roomId) return;

            // Apply damage
            if (damageAmount > 0) {
                npc.takeDamage(damageAmount);
                
                // Notify everyone in the room about the NPC taking damage
                this.notifyRoom(targetId, `The ${npc.name} takes ${damageAmount} damage from ${effect.name}.`);
                
                // Check if NPC died
                if (npc.health <= 0) {
                    // Notify room about NPC death
                    this.notifyRoom(targetId, `The ${npc.name} has died from ${effect.name}!`);
                    
                    // Handle NPC death - remove from room
                    this.handleNpcDeath(npc, targetId, roomId);
                }
            }

            // Apply healing
            if (healAmount > 0) {
                const maxHealth = npc.maxHealth;
                npc.health = Math.min(npc.health + healAmount, maxHealth);
                
                // Notify everyone in the room about the NPC healing
                this.notifyRoom(targetId, `The ${npc.name} gains ${healAmount} health from ${effect.name}.`);
            }
        }
    }
    
    /**
     * Handle player death (similar to CombatSystem logic)
     */
    private handlePlayerDeath(client: ConnectedClient): void {
        if (!client.user) return;
        
        const username = client.user.username;
        const roomId = client.user.currentRoomId;
        if (!roomId) return;
        
        // Remove from combat if in combat
        const combat = this.combatSystem.findClientByUsername(username);
        if (combat) {
            this.combatSystem.breakCombat(client);
        }
        
        // Drop inventory items in the current room
        this.dropPlayerInventory(client, roomId);
        
        // Teleport to starting room
        this.teleportToStartingRoom(client);
        
        // Reset health to 50% of max
        client.user.health = Math.floor(client.user.maxHealth * 0.5);
        client.user.isUnconscious = false;
        
        // Update stats
        this.userManager.updateUserStats(username, { 
            health: client.user.health,
            isUnconscious: false
        });
    }
    
    /**
     * Handle NPC death (similar to CombatSystem logic)
     */
    private handleNpcDeath(npc: any, npcId: string, roomId: string): void {
        // Remove NPC from room
        this.roomManager.removeNPCFromRoom(roomId, npcId);
        
        // Clean up NPC from combat system tracking
        this.combatSystem.cleanupDeadEntity(roomId, npcId);
        
        console.log(`[EffectManager] NPC ${npcId} died in room ${roomId} from an effect`);
    }
    
    /**
     * Drop player's inventory in current room on death
     */
    private dropPlayerInventory(client: ConnectedClient, roomId: string): void {
        if (!client.user || !client.user.inventory) return;
        
        const room = this.roomManager.getRoom(roomId);
        if (!room) return;
        
        // Drop all items
        if (client.user.inventory.items && client.user.inventory.items.length > 0) {
            // Create item list message
            const itemsList = client.user.inventory.items.join(', ');
            this.notifyRoom(client.user.username, `${client.user.username}'s corpse drops: ${itemsList}.`);
            
            // Add items to room
            for (const item of client.user.inventory.items) {
                room.addItem(item);
            }
            
            // Clear player's inventory
            client.user.inventory.items = [];
        }
        
        // Transfer currency
        if (client.user.inventory.currency) {
            const currency = client.user.inventory.currency;
            
            if (currency.gold > 0 || currency.silver > 0 || currency.copper > 0) {
                room.currency.gold += currency.gold || 0;
                room.currency.silver += currency.silver || 0;
                room.currency.copper += currency.copper || 0;
                
                // Format currency for message
                const parts = [];
                if (currency.gold > 0) parts.push(`${currency.gold} gold`);
                if (currency.silver > 0) parts.push(`${currency.silver} silver`);
                if (currency.copper > 0) parts.push(`${currency.copper} copper`);
                
                if (parts.length > 0) {
                    const currencyText = parts.join(', ');
                    this.notifyRoom(client.user.username, `${client.user.username}'s corpse drops ${currencyText}.`);
                }
                
                // Clear player's currency
                client.user.inventory.currency = { gold: 0, silver: 0, copper: 0 };
            }
        }
        
        // Update the room
        this.roomManager.updateRoom(room);
        
        // Update player inventory in database
        this.userManager.updateUserStats(client.user.username, { inventory: client.user.inventory });
    }
    
    /**
     * Teleport a player to the starting room
     */
    private teleportToStartingRoom(client: ConnectedClient): void {
        if (!client.user) return;
        
        const startRoomId = this.roomManager.getStartingRoomId();
        const currentRoomId = client.user.currentRoomId;
        
        // Remove from current room
        if (currentRoomId) {
            const currentRoom = this.roomManager.getRoom(currentRoomId);
            if (currentRoom) {
                currentRoom.removePlayer(client.user.username);
                this.roomManager.updateRoom(currentRoom);
            }
        }
        
        // Add to starting room
        const startRoom = this.roomManager.getRoom(startRoomId);
        if (startRoom) {
            startRoom.addPlayer(client.user.username);
            this.roomManager.updateRoom(startRoom);
            
            // Update player's current room
            client.user.currentRoomId = startRoomId;
            this.userManager.updateUserStats(client.user.username, { currentRoomId: startRoomId });
            
            // Show starting room to player
            writeFormattedMessageToClient(
                client,
                `\r\n\x1b[33mYou have been teleported to the starting area.\x1b[0m\r\n`
            );
            
            // Show room description
            writeFormattedMessageToClient(
                client,
                startRoom.getDescriptionExcludingPlayer(client.user.username)
            );
            
            // Announce to others in starting room
            this.notifyRoom(client.user.username, `${client.user.username} materializes in the room, looking disoriented.`);
        }
    }

    /**
     * Notify all players in a room about an event
     */
    private notifyRoom(playerOrNpcId: string, message: string, excludeUsername?: string): void {
        const roomId = this.getRoomIdForEntity(playerOrNpcId);
        if (!roomId) return;

        // Get room and check for players
        const room = this.roomManager.getRoom(roomId);
        if (!room || !room.players) return;

        // Notify each player in the room
        for (const username of room.players) {
            if (excludeUsername && username === excludeUsername) continue;
            const client = this.userManager.getActiveUserSession(username);
            if (client) {
                writeFormattedMessageToClient(client, `\r\n${message}\r\n`);
            }
        }
    }

    /**
     * Get the room ID for a player or NPC
     */
    private getRoomIdForEntity(entityId: string): string | null {
        // First check if it's a player
        const client = this.userManager.getActiveUserSession(entityId);
        if (client && client.user) {
            return client.user.currentRoomId;
        }

        // Otherwise find the NPC's room
        return this.findRoomForNpc(entityId);
    }

    /**
     * Find a room containing an NPC by its instance ID
     */
    private findRoomForNpc(npcInstanceId: string): string | null {
        // Check each room for the NPC with the given instance ID
        const rooms = this.roomManager.getAllRooms();
        
        for (const room of rooms) {
            // Check if the NPC exists in this room
            if (room.npcs.has(npcInstanceId) || room.getNPC(npcInstanceId)) {
                return room.id;
            }
        }
        
        console.warn(`[EffectManager] Could not find room for NPC with instance ID: ${npcInstanceId}`);
        return null;
    }

    /**
     * Find an NPC by its instance ID
     */
    private findNpcById(npcInstanceId: string): any {
        // Search through rooms to find the NPC by instance ID
        const roomId = this.findRoomForNpc(npcInstanceId);
        if (!roomId) {
            console.warn(`[EffectManager] findNpcById: Could not find room for NPC with instance ID: ${npcInstanceId}`);
            return null;
        }
        
        // Get the actual NPC instance
        return this.roomManager.getNPCFromRoom(roomId, npcInstanceId);
    }
}