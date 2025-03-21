import { ClientState, ClientStateType, ConnectedClient } from '../types';
import { colorize, colors } from '../utils/colors';
import { writeToClient, writeMessageToClient, writeFormattedMessageToClient } from '../utils/socketWriter';
import { formatUsername } from '../utils/formatters';
import { writeCommandPrompt } from '../utils/promptFormatter';
import { RoomManager } from '../room/roomManager';

export class AuthenticatedState implements ClientState {
  name = ClientStateType.AUTHENTICATED;
  private roomManager: RoomManager;

  constructor(private clients: Map<string, ConnectedClient>) {
    // Use singleton instance
    this.roomManager = RoomManager.getInstance(clients);
  }

  enter(client: ConnectedClient): void {
    if (!client.user) return;
    
    // Prevent duplicate welcome messages with a state flag
    if (client.stateData.welcomeDisplayed) {
      // Skip welcome message if already displayed
      // Just ensure the player is in the correct room
      this.ensurePlayerInRoom(client);
      writeCommandPrompt(client);
      return;
    }
    
    // Set flag to prevent duplicate welcome messages
    client.stateData.welcomeDisplayed = true;
    
    writeToClient(client, colors.clear);
    writeToClient(client, colorize('========================================\r\n', 'bright'));
    writeToClient(client, colorize(`Welcome, ${formatUsername(client.user.username)}!\r\n`, 'green'));
    writeToClient(client, colorize(`Health: ${client.user.health}/${client.user.maxHealth} | XP: ${client.user.experience} | Level: ${client.user.level}\r\n`, 'cyan'));
    writeToClient(client, colorize('Type "help" for a list of commands.\r\n', 'yellow'));
    writeToClient(client, colorize('========================================\r\n', 'bright'));
    
    // Send login broadcast to all other users
    this.broadcastLogin(client);
    
    // Ensure user is properly placed in a room
    this.ensurePlayerInRoom(client);
    
    // Add the command prompt showing HP status at the end
    writeCommandPrompt(client);
  }

  handle(): void {
    // Command handling is done separately in CommandHandler
  }

  // Broadcast login notification to all authenticated users except the one logging in
  private broadcastLogin(joiningClient: ConnectedClient): void {
    if (!joiningClient.user) return;

    const username = formatUsername(joiningClient.user.username);
    const message = `${username} has entered the game.\r\n`;
    
    for (const [_, client] of this.clients.entries()) {
      // Only send to authenticated users who are not the joining client
      if (client.authenticated && client !== joiningClient) {
        writeFormattedMessageToClient(client, colorize(message, 'bright'));
      }
    }
  }

  // Helper method to ensure player is in the correct room
  private ensurePlayerInRoom(client: ConnectedClient): void {
    if (!client.user) return;
    
    // Ensure user is placed in a room if they don't have one
    if (!client.user.currentRoomId) {
      client.user.currentRoomId = this.roomManager.getStartingRoomId();
    }
    
    // Show the room description when user enters the game
    const room = this.roomManager.getRoom(client.user.currentRoomId);
    if (room) {
      // Before adding the player to this room, check if they're already in any room
      // and remove them from those rooms first
      this.roomManager.removePlayerFromAllRooms(client.user.username);
      
      // Now safely add the player to their current room
      room.addPlayer(client.user.username);
      
      // Announce this player's entry to the room to all other players
      this.roomManager.announcePlayerEntrance(client.user.currentRoomId, client.user.username);
      
      // Use the Room's method for consistent formatting
      writeToClient(client, room.getDescriptionExcludingPlayer(client.user.username));
    } else {
      // Player is in an invalid room, teleport them to the starting room
      this.roomManager.teleportToStartingRoom(client);
    }
  }
}
