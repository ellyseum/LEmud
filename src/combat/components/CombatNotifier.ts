import { ConnectedClient } from '../../types';
import { CombatEntity } from '../combatEntity.interface';
import { colorize, ColorType } from '../../utils/colors';
import { writeFormattedMessageToClient, drawCommandPrompt, writeToClient } from '../../utils/socketWriter';
import { RoomManager } from '../../room/roomManager';
import { formatUsername } from '../../utils/formatters';

/**
 * Responsible for all combat-related messaging to clients
 */
export class CombatNotifier {
  constructor(private roomManager: RoomManager) {}

  /**
   * Notify player and room about an attack result
   */
  notifyAttackResult(
    attacker: CombatEntity, 
    target: ConnectedClient, 
    roomId: string, 
    hit: boolean, 
    damage: number = 0
  ): void {
    if (!target.user) return;
    
    // Format the target name for broadcast messages
    const targetNameFormatted = formatUsername(target.user.username);
    
    if (hit) {
      // Send message to the targeted player
      writeFormattedMessageToClient(
        target,
        colorize(`The ${attacker.name} ${attacker.getAttackText('you')} for ${damage} damage.\r\n`, 'red')
      );
      
      // Broadcast to ALL players in room except the target
      this.broadcastRoomMessage(
        roomId,
        `The ${attacker.name} ${attacker.getAttackText(targetNameFormatted)} for ${damage} damage.\r\n`,
        'red',
        target.user.username
      );
    } else {
      // Send message to the targeted player about the miss
      writeFormattedMessageToClient(
        target,
        colorize(`The ${attacker.name} ${attacker.getAttackText('you')} and misses!\r\n`, 'cyan')
      );
      
      // Broadcast to ALL players in room except the target
      this.broadcastRoomMessage(
        roomId,
        `The ${attacker.name} ${attacker.getAttackText(targetNameFormatted)} and misses!\r\n`,
        'cyan',
        target.user.username
      );
    }
  }

  /**
   * Notify a player they've died and broadcast to room
   */
  notifyPlayerDeath(player: ConnectedClient, roomId: string): void {
    if (!player.user) return;
    
    // Send death message to player
    writeFormattedMessageToClient(
      player,
      colorize(`You have died! Your body will be transported to the starting area.\r\n`, 'red')
    );
    
    // Broadcast to others using the default boldYellow for status messages
    const username = formatUsername(player.user.username);
    const message = `${username} has died!\r\n`;
    
    // Broadcast to all other players in the room
    this.broadcastRoomMessage(roomId, message, 'boldYellow', player.user.username);
  }

  /**
   * Notify a player they've fallen unconscious and broadcast to room
   */
  notifyPlayerUnconscious(player: ConnectedClient, roomId: string): void {
    if (!player.user) return;
    
    // Send unconscious message to player
    writeFormattedMessageToClient(
      player,
      colorize(`You collapse to the ground unconscious! You are bleeding out and will die at -10 HP.\r\n`, 'red')
    );
    
    // Broadcast to others using the default boldYellow for status messages
    const username = formatUsername(player.user.username);
    const message = `${username} has fallen unconscious!\r\n`;
    
    // Broadcast to all other players in the room
    this.broadcastRoomMessage(roomId, message, 'boldYellow', player.user.username);
  }

  /**
   * Notify a player they've been teleported to the starting room
   */
  notifyPlayerTeleported(player: ConnectedClient, startingRoom: any): void {
    if (!player.user) return;
    
    // Show the starting room to the player
    writeFormattedMessageToClient(
      player,
      colorize(`You have been teleported to the starting area.\r\n`, 'yellow')
    );
    
    // Show the room description
    const roomDescription = startingRoom.getDescriptionExcludingPlayer(player.user.username);
    writeToClient(player, roomDescription);
    
    // Announce to others in the starting room
    const username = formatUsername(player.user.username);
    this.broadcastRoomMessage(
      startingRoom.id,
      `${username} materializes in the room, looking disoriented.\r\n`,
      'yellow',
      player.user.username
    );
  }

  /**
   * Broadcast combat start to other players in the room
   */
  broadcastCombatStart(player: ConnectedClient, target: CombatEntity): void {
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
        writeFormattedMessageToClient(client, message);
      }
    }
  }

  /**
   * Broadcast a message to all players in a room regarding combat
   */
  broadcastRoomMessage(
    roomId: string, 
    message: string, 
    color: ColorType = 'boldYellow', 
    excludeUsername?: string
  ): void {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return;

    const formattedMessage = colorize(message, color as any);
    
    for (const playerName of room.players) {
      // Skip excluded player if specified
      if (excludeUsername && playerName === excludeUsername) continue;
      
      const client = this.findClientByUsername(playerName);
      if (client) {
        writeFormattedMessageToClient(client, formattedMessage);
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