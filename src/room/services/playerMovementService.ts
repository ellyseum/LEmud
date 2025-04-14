// filepath: /Users/jelden/projects/game/src/room/services/playerMovementService.ts
import { IPlayerMovementService } from '../interfaces';
import { ConnectedClient } from '../../types';
import { Room } from '../room';
import { colorize } from '../../utils/colors';
import { writeToClient, writeFormattedMessageToClient, drawCommandPrompt } from '../../utils/socketWriter';
import { formatUsername } from '../../utils/formatters';
import { getPlayerLogger } from '../../utils/logger';

export class PlayerMovementService implements IPlayerMovementService {
  private roomManager: {
    getRoom: (roomId: string) => Room | undefined;
    getStartingRoomId: () => string;
  };
  private directionHelper: {
    getOppositeDirection: (direction: string) => string;
    getFullDirectionName: (direction: string) => string;
  };
  private notifyPlayersInRoom: (roomId: string, message: string, excludeUsername?: string) => void;
  private clients: Map<string, ConnectedClient>;

  constructor(
    roomManager: {
      getRoom: (roomId: string) => Room | undefined;
      getStartingRoomId: () => string;
    },
    directionHelper: {
      getOppositeDirection: (direction: string) => string;
      getFullDirectionName: (direction: string) => string;
    },
    notifyPlayersInRoom: (roomId: string, message: string, excludeUsername?: string) => void,
    clients: Map<string, ConnectedClient>
  ) {
    this.roomManager = roomManager;
    this.directionHelper = directionHelper;
    this.notifyPlayersInRoom = notifyPlayersInRoom;
    this.clients = clients;
  }

  /**
   * Calculate movement delay based on character agility
   * @param agility The player's agility stat
   * @returns Delay in milliseconds
   */
  private calculateMovementDelay(agility: number): number {
    // Base delay is 3000ms (3 seconds)
    const baseDelay = 3000;
    
    // Calculate reduction based on agility (higher agility = less delay)
    // Each point of agility reduces delay by 100ms (10% of base per 10 agility)
    const reduction = Math.min(agility * 100, baseDelay * 0.8); // Cap at 80% reduction
    
    // Return the adjusted delay (minimum 500ms)
    return Math.max(baseDelay - reduction, 500);
  }

  /**
   * Move a player to a new room with travel delay based on character speed
   * @param client The connected client
   * @param direction The direction to move
   * @returns true if movement succeeded, false otherwise
   */
  public movePlayerWithDelay(client: ConnectedClient, direction: string): boolean {
    if (!client.user) return false;

    // Check if player movement is restricted
    if (client.user.movementRestricted) {
      const reason = client.user.movementRestrictedReason || "You are unable to move.";
      writeToClient(client, colorize(`${reason}\r\n`, 'red'));
      return false;
    }

    // Get current room
    const currentRoomId = client.user.currentRoomId || this.roomManager.getStartingRoomId();
    const currentRoom = this.roomManager.getRoom(currentRoomId);

    if (!currentRoom) {
      writeToClient(client, colorize(`You seem to be lost in the void. Teleporting to safety...\r\n`, 'red'));
      // Handle teleportation via callback function
      return false; // This will be handled by teleport service
    }

    // Check if exit exists
    const nextRoomId = currentRoom.getExit(direction);
    if (!nextRoomId) {
      writeToClient(client, colorize(`There is no exit in that direction.\r\n`, 'red'));
      
      // Notify other players in the room about the wall collision
      // Get full direction name for the message
      const fullDirectionName = this.directionHelper.getFullDirectionName(direction);
      this.notifyPlayersInRoom(
        currentRoomId,
        `${formatUsername(client.user.username)} runs into a wall trying to go ${fullDirectionName}.\r\n`,
        client.user.username
      );
      
      return false;
    }

    // Get destination room
    const nextRoom = this.roomManager.getRoom(nextRoomId);
    if (!nextRoom) {
      writeToClient(client, colorize(`The destination room doesn't exist.\r\n`, 'red'));
      return false;
    }

    // Get the full direction name for messages
    const fullDirectionName = this.directionHelper.getFullDirectionName(direction);
    
    // Get the opposite direction for the arrival message
    const oppositeDirection = this.directionHelper.getOppositeDirection(direction);
    const fullOppositeDirectionName = this.directionHelper.getFullDirectionName(oppositeDirection);
    
    // Notify players in current room that this player is leaving (but not yet gone)
    this.notifyPlayersInRoom(
      currentRoomId,
      `${formatUsername(client.user.username)} starts moving ${fullDirectionName}.\r\n`,
      client.user.username
    );

    // Calculate movement delay based on agility
    // Default to 10 if agility is undefined
    const agility = client.user.agility || 10;
    const delay = this.calculateMovementDelay(agility);

    // Inform player they're moving - use writeToClient instead of writeFormattedMessageToClient
    // to avoid redrawing the prompt after this message
    writeToClient(client, colorize(`Moving${delay > 1000 ? ' slowly' : ''}...\r\n`, 'green'));
    
    // Flag to prevent multiple moves while moving
    if (!client.stateData) {
      client.stateData = {};
    }
    client.stateData.isMoving = true;
    
    // Suppress the prompt until movement is complete
    client.stateData.suppressPrompt = true;
    
    // Set a timeout to perform the actual room transition after the delay
    setTimeout(() => {
      // Make sure client.user is still available when the timeout executes
      if (client.user) {
        // NOW remove the player from the old room
        currentRoom.removePlayer(client.user.username);

        // NOW add the player to the new room
        nextRoom.addPlayer(client.user.username);
        
        // NOW notify players in the old room that this player has left
        this.notifyPlayersInRoom(
          currentRoomId,
          `${formatUsername(client.user.username)} leaves ${fullDirectionName}.\r\n`,
          client.user.username
        );
        
        // NOW notify players in the destination room that this player has arrived
        this.notifyPlayersInRoom(
          nextRoomId, 
          `${formatUsername(client.user.username)} enters from the ${fullOppositeDirectionName}.\r\n`,
          client.user.username
        );

        // NOW update user's current room
        client.user.currentRoomId = nextRoomId;

        // Log the player's movement
        const playerLogger = getPlayerLogger(client.user.username);
        playerLogger.info(`Moved to room ${nextRoomId}: ${nextRoom.name}`);
        
        // Show the new room description with formatted message to redraw prompt after
        writeFormattedMessageToClient(
          client, 
          nextRoom.getDescriptionExcludingPlayer(client.user.username),
          true // Explicitly set drawPrompt to true
        );
        
        // Process any commands that were buffered during movement
        if (client.stateData.movementCommandQueue && client.stateData.movementCommandQueue.length > 0) {
          // Extract the queued commands
          const commandQueue = [...client.stateData.movementCommandQueue];
          
          // Clear the queue
          client.stateData.movementCommandQueue = [];
          
          // Process only the first command after movement is complete
          // We'll handle multiple movement commands sequentially
          setTimeout(() => {
            // Import the CommandHandler directly to avoid circular dependency issues
            const { CommandHandler } = require('../../command/commandHandler');
            const userManager = require('../../user/userManager').UserManager.getInstance();
            
            // Create a new instance of CommandHandler
            const commandHandler = new CommandHandler(this.clients, userManager, this.roomManager);
            
            // Process only the first command in the queue
            if (commandQueue.length > 0) {
              const cmd = commandQueue.shift(); // Take the first command
              commandHandler.handleCommand(client, cmd);
              
              // If there are more commands in the queue, save them back to the client
              // They'll be processed after any resulting movement completes
              if (commandQueue.length > 0) {
                if (!client.stateData) {
                  client.stateData = {};
                }
                client.stateData.movementCommandQueue = commandQueue;
              }
            }
          }, 100);
        }
        
        // Clear the moving flags
        if (client.stateData) {
          client.stateData.isMoving = false;
          client.stateData.suppressPrompt = false;
        }
        
        // Force redraw of the prompt to ensure it appears
        drawCommandPrompt(client);
      }
    }, delay);
    
    return true;
  }

  // Original movePlayer method kept for backward compatibility
  public movePlayer(client: ConnectedClient, direction: string): boolean {
    return this.movePlayerWithDelay(client, direction);
  }
}