// filepath: /Users/jelden/projects/game/src/command/commands/root.command.ts
import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';
import { RoomManager } from '../../room/roomManager';
import { EffectManager } from '../../effects/effectManager';
import { EffectType } from '../../types/effects';

export class RootCommand implements Command {
  name = 'root';
  description = 'Root a target to the ground, preventing them from moving';
  
  private userManager: UserManager;
  private roomManager: RoomManager;
  private effectManager: EffectManager;
  
  constructor(userManager: UserManager, roomManager: RoomManager) {
    this.userManager = userManager;
    this.roomManager = roomManager;
    this.effectManager = EffectManager.getInstance(userManager, roomManager);
    
    // Register for effect events to handle custom messages
    this.effectManager.on('effectAdded', this.handleEffectAdded.bind(this));
    this.effectManager.on('effectRemoved', this.handleEffectRemoved.bind(this));
  }
  
  execute(client: ConnectedClient, args: string): void {
    if (!client.user) {
      writeToClient(client, colorize('You must be logged in to use this command.\r\n', 'red'));
      return;
    }
    
    // Check if player provided a target
    const targetName = args.trim();
    if (!targetName) {
      writeToClient(client, colorize('Root who?\r\n', 'yellow'));
      return;
    }
    
    // Check if the target exists
    const targetClient = this.userManager.getActiveUserSession(targetName);
    if (!targetClient || !targetClient.user) {
      writeToClient(client, colorize(`${targetName} is not online.\r\n`, 'red'));
      return;
    }
    
    if (!client.user.currentRoomId || !targetClient.user.currentRoomId) {
      writeToClient(client, colorize(`You must be in a room to use this command.\r\n`, 'red'));
      return;
    }
    
    // Check if the target is in the same room
    if (client.user.currentRoomId !== targetClient.user.currentRoomId) {
      writeToClient(client, colorize(`${targetName} is not here.\r\n`, 'red'));
      return;
    }
    
    // Apply the root effect
    const REAL_TIME_INTERVAL_MS = 3000; // 3 seconds
    
    // Store the username to avoid null reference inside the loop
    const casterUsername = client.user.username;
    
    // Announce the rooting to the room
    const room = this.roomManager.getRoom(client.user.currentRoomId);
    if (room) {
      room.players.forEach(playerName => {
        const playerClient = this.userManager.getActiveUserSession(playerName);
        if (playerClient) {
          writeToClient(playerClient, colorize(`${casterUsername} casts root on ${targetName}.\r\n`, 'blue'));
        }
      });
    }
    
    // Apply the movement block effect using the effect system
    this.effectManager.addEffect(targetName, true, {
      type: EffectType.MOVEMENT_BLOCK,
      name: 'Root',
      description: 'Your feet are rooted firmly to the ground.',
      durationTicks: 1, // Just 1 tick duration
      isTimeBased: true, // Use real time instead of game ticks
      tickInterval: 0, // Don't apply any periodic effects
      realTimeIntervalMs: REAL_TIME_INTERVAL_MS, 
      payload: {
        blockMovement: true,
        metadata: {
          rootCommand: true // Custom metadata to identify this is from the root command
        }
      },
      targetId: targetName,
      isPlayerEffect: true,
      sourceId: client.user.username
    });
  }
  
  private handleEffectAdded(data: { targetId: string, isPlayer: boolean, effect: any }): void {
    const { targetId, isPlayer, effect } = data;
    
    // Only process for our root command effects
    if (isPlayer && 
        effect.type === EffectType.MOVEMENT_BLOCK && 
        effect.payload?.metadata?.rootCommand) {
      
      // Set the custom restriction reason
      const client = this.userManager.getActiveUserSession(targetId);
      if (client && client.user) {
        client.user.movementRestricted = true;
        client.user.movementRestrictedReason = "Your feet are rooted firmly to the ground.";
      }
    }
  }
  
  private handleEffectRemoved(data: { targetId: string, isPlayer: boolean, effect: any }): void {
    const { targetId, isPlayer, effect } = data;
    
    // Only process for our root command effects
    if (isPlayer && 
        effect.type === EffectType.MOVEMENT_BLOCK && 
        effect.payload?.metadata?.rootCommand) {
      
      // Clear the movement restriction
      const client = this.userManager.getActiveUserSession(targetId);
      if (client && client.user) {
        client.user.movementRestricted = false;
        client.user.movementRestrictedReason = undefined;
        
        // Send the completion message to the player
        writeToClient(client, colorize('Your feet are no longer rooted to the ground.\r\n', 'brightGreen'));
      }
    }
  }
}