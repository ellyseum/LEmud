import { ClientState, ClientStateType, ConnectedClient } from '../types';
import { colorize, colors } from '../utils/colors';
import { writeToClient } from '../utils/socketWriter';
import { formatUsername } from '../utils/formatters';
import { writeCommandPrompt } from '../utils/promptFormatter';
import { RoomManager } from '../room/roomManager';

export class AuthenticatedState implements ClientState {
  name = ClientStateType.AUTHENTICATED;
  private roomManager: RoomManager;

  constructor(private clients: Map<string, ConnectedClient>) {
    // Pass clients to RoomManager
    this.roomManager = new RoomManager(clients);
  }

  enter(client: ConnectedClient): void {
    if (!client.user) return;
    
    writeToClient(client, colors.clear);
    writeToClient(client, colorize('========================================\r\n', 'bright'));
    writeToClient(client, colorize(`Welcome, ${formatUsername(client.user.username)}!\r\n`, 'green'));
    writeToClient(client, colorize(`Health: ${client.user.health}/${client.user.maxHealth} | XP: ${client.user.experience} | Level: ${client.user.level}\r\n`, 'cyan'));
    writeToClient(client, colorize('Type "help" for a list of commands.\r\n', 'yellow'));
    writeToClient(client, colorize('========================================\r\n', 'bright'));
    
    // Ensure user is placed in a room if they don't have one
    if (!client.user.currentRoomId) {
      client.user.currentRoomId = this.roomManager.getStartingRoomId();
    }
    
    // Show the room description when user enters the game
    const room = this.roomManager.getRoom(client.user.currentRoomId);
    if (room) {
      // Add the player to the room
      room.addPlayer(client.user.username);
      
      // Use the Room's method for consistent formatting
      writeToClient(client, room.getDescriptionExcludingPlayer(client.user.username));
    }
    
    // Add the command prompt showing HP status
    writeCommandPrompt(client);
  }

  handle(): void {
    // Command handling is done separately in CommandHandler
  }
}
