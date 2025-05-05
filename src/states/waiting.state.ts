import { RoomManager } from "../room/roomManager";
import { ClientState, ClientStateType, ConnectedClient } from "../types";
import { UserManager } from "../user/userManager";
import { colorize } from "../utils/colors";
import { formatUsername } from "../utils/formatters";
import { systemLogger } from "../utils/logger";
import { writeFormattedMessageToClient, writeToClient } from "../utils/socketWriter";

export class WaitingState implements ClientState {
  name = ClientStateType.WAITING;
  private clients: Map<string, ConnectedClient>;
  private userManager: UserManager;

  // Static reference to the global clients map
  private static globalClients: Map<string, ConnectedClient> | null = null;

  constructor() {
    this.userManager = UserManager.getInstance();
    // Initialize clients as an empty map - will get the real one in enter()
    this.clients = new Map<string, ConnectedClient>();
  }

  /**
   * Set the global clients map - to be called from the server initialization
   */
  public static setGlobalClients(clients: Map<string, ConnectedClient>): void {
    WaitingState.globalClients = clients;
  }

  enter(client: ConnectedClient): void {
    // Store the previous state to return to when waiting ends
    client.stateData.previousState =
      client.stateData.previousState || ClientStateType.AUTHENTICATED;

    // Get access to the global clients map
    if (WaitingState.globalClients) {
      this.clients = WaitingState.globalClients;
    } else if (client.stateData.clientsMap) {
      this.clients = client.stateData.clientsMap;
    }

    // Remove player from the game world before entering waiting state
    if (client.user) {
      // Get RoomManager instance with the correct clients map
      const roomManager = RoomManager.getInstance(this.clients);

      // Store current room ID for later
      client.stateData.previousRoomId = client.user.currentRoomId;

      // Get the username for messaging
      const username = formatUsername(client.user.username);

      // Broadcast to all players that this player is leaving the game for waiting
      this.broadcastToAllPlayers(`${username} steps away from the realm for a moment.\r\n`);

      // Remove player from rooms to protect them from combat and interactions
      roomManager.removePlayerFromAllRooms(client.user.username);
    }

    // Display waiting message
    this.clearScreen(client);
    writeToClient(client, colorize('Waiting. Press X to end.\r\n', 'cyan'));
  }

  handle(client: ConnectedClient, input: string): void {
    // Check for 'X' to end waiting
    if (input.toLowerCase() === 'x') {
      this.endWaiting(client);
      return;
    }

    // Ctrl+C as emergency exit
    if (input === '\u0003') {
      this.endWaiting(client);
      return;
    }

    // Any other input just shows the waiting message again
    writeToClient(client, colorize('Waiting. Press X to end.\r\n', 'cyan'));
  }

  private endWaiting(client: ConnectedClient): void {
    // Add player back to the game world after ending waiting state
    if (client.user) {
      // Get RoomManager instance with the correct clients map
      const roomManager = RoomManager.getInstance(this.clients);

      // Get the room ID the player was in before waiting
      const previousRoomId =
        client.stateData.previousRoomId || roomManager.getStartingRoomId();

      // Add the player back to their previous room
      const room = roomManager.getRoom(previousRoomId);
      if (room) {
        room.addPlayer(client.user.username);
        client.user.currentRoomId = previousRoomId;
        client.user.inCombat = false; // Reset combat state
      }

      // Get the username for messaging
      const username = formatUsername(client.user.username);

      // Broadcast to all players that this player is returning
      this.broadcastToAllPlayers(`${username} returns to the realm.\r\n`);
    }

    // Transition back to previous state (usually authenticated)
    client.stateData.transitionTo = client.stateData.previousState;
  }

  /**
   * Broadcasts a message to all authenticated players in the game
   */
  private broadcastToAllPlayers(message: string): void {
    // Directly iterate through all clients in the global clients map
    this.clients.forEach((client) => {
      if (client.authenticated && client.user) {
        writeFormattedMessageToClient(client, colorize(message, "bright"));
      }
    });
  }

  private clearScreen(client: ConnectedClient): void {
    // ANSI escape code to clear the screen and move the cursor to the top-left corner
    writeToClient(client, "\u001b[2J\u001b[H");
  }

  exit(client: ConnectedClient): void {
    // Clean up any waiting state resources
    if (client.user) {
      // Get username for logging
      const username = client.user.username;
      systemLogger.debug(`User ${username} exiting waiting state`);
    }
  }
}
