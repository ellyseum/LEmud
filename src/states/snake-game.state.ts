import { ClientState, ClientStateType, ConnectedClient } from "../types";
import { colorize, colors } from "../utils/colors";
import {
  writeToClient,
  writeFormattedMessageToClient,
} from "../utils/socketWriter";
import { UserManager } from "../user/userManager";
import { RoomManager } from "../room/roomManager";
import { formatUsername } from "../utils/formatters";
import { StateMachine } from "../state/stateMachine";

// Define snake game types
interface Position {
  x: number;
  y: number;
}

type Direction = "up" | "down" | "left" | "right";

// Define score entry for leaderboard
interface ScoreEntry {
  username: string;
  score: number;
}

export class SnakeGameState implements ClientState {
  name = ClientStateType.SNAKE_GAME;

  // Game settings
  private boardWidth = 20;
  private boardHeight = 10;
  private tickSpeed = 200; // ms between game updates

  // Game state
  private snake: Position[] = [];
  private food: Position = { x: 0, y: 0 };
  private direction: Direction = "right";
  private score = 0;
  private gameLoopId: NodeJS.Timeout | null = null;
  private gameOver = false;
  private inputQueue: Direction[] = []; // Queue to store input directions
  private userManager: UserManager;
  private clients: Map<string, ConnectedClient>;

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
    SnakeGameState.globalClients = clients;
  }

  enter(client: ConnectedClient): void {
    // Store the previous state to return to when game ends
    client.stateData.previousState =
      client.stateData.previousState || ClientStateType.AUTHENTICATED;

    // Get access to the global clients map
    if (SnakeGameState.globalClients) {
      this.clients = SnakeGameState.globalClients;
    } else if (client.stateData.clientsMap) {
      this.clients = client.stateData.clientsMap;
    }

    // Reset game state variables
    this.snake = [];
    this.score = 0;
    this.gameOver = false;
    this.direction = "right";
    this.inputQueue = [];
    if (this.gameLoopId) {
      clearInterval(this.gameLoopId);
      this.gameLoopId = null;
    }

    // Reset tick speed to default
    this.tickSpeed = 200;

    // Remove player from the game world before starting the snake game
    if (client.user) {
      // Get RoomManager instance with the correct clients map
      const roomManager = RoomManager.getInstance(this.clients);

      // Store current room ID for later
      client.stateData.previousRoomId = client.user.currentRoomId;

      // Get the username for messaging
      const username = formatUsername(client.user.username);

      // Broadcast to all players that this player is leaving the realm
      this.broadcastToAllPlayers(`${username} leaves the game.\r\n`);

      // Remove player from rooms to protect them from combat and interactions
      roomManager.removePlayerFromAllRooms(client.user.username);
    }

    // Initialize game state
    this.initGame();

    // Show instructions first
    this.showInstructions(client);

    // Draw initial game state
    this.drawGame(client);

    // Start game loop with a short delay
    writeToClient(client, colorize("\r\nGet ready to play...\r\n", "yellow"));
    setTimeout(() => this.startGameLoop(client), 1000);
  }

  handle(client: ConnectedClient, input: string): void {
    // Handle exit command
    if (input.trim().toLowerCase() === "x") {
      this.endGame(client);
      return;
    }

    // Handle arrow keys with all possible terminal/telnet formats
    let direction: Direction | null = null;

    // Up arrow (various possible formats)
    if (
      input === "\u001b[A" ||
      input === "[A" ||
      input === "\u001bOA" ||
      input === "OA"
    ) {
      if (this.direction !== "down") {
        direction = "up";
      }
    }
    // Down arrow (various possible formats)
    else if (
      input === "\u001b[B" ||
      input === "[B" ||
      input === "\u001bOB" ||
      input === "OB"
    ) {
      if (this.direction !== "up") {
        direction = "down";
      }
    }
    // Left arrow (various possible formats)
    else if (
      input === "\u001b[D" ||
      input === "[D" ||
      input === "\u001bOD" ||
      input === "OD"
    ) {
      if (this.direction !== "right") {
        direction = "left";
      }
    }
    // Right arrow (various possible formats)
    else if (
      input === "\u001b[C" ||
      input === "[C" ||
      input === "\u001bOC" ||
      input === "OC"
    ) {
      if (this.direction !== "left") {
        direction = "right";
      }
    }
    // WASD keys
    else {
      const key = input.trim().toLowerCase();
      if (key === "w" && this.direction !== "down") {
        direction = "up";
      } else if (key === "s" && this.direction !== "up") {
        direction = "down";
      } else if (key === "a" && this.direction !== "right") {
        direction = "left";
      } else if (key === "d" && this.direction !== "left") {
        direction = "right";
      }
    }

    // If valid direction, add to input queue
    if (direction) {
      const lastDirection =
        this.inputQueue.length > 0
          ? this.inputQueue[this.inputQueue.length - 1]
          : this.direction;

      // Make sure we're not trying to reverse direction (which would cause instant death)
      if (
        (direction === "up" && lastDirection !== "down") ||
        (direction === "down" && lastDirection !== "up") ||
        (direction === "left" && lastDirection !== "right") ||
        (direction === "right" && lastDirection !== "left")
      ) {
        this.inputQueue.push(direction);
      }
    }
  }

  private initGame(): void {
    // Initialize snake at center of board
    const startX = Math.floor(this.boardWidth / 2);
    const startY = Math.floor(this.boardHeight / 2);

    this.snake = [
      { x: startX, y: startY },
      { x: startX - 1, y: startY },
      { x: startX - 2, y: startY },
    ];

    // Set initial direction
    this.direction = "right";

    // Place food
    this.placeFood();

    // Reset score and game state
    this.score = 0;
    this.gameOver = false;
  }

  private placeFood(): void {
    // Find a position that doesn't overlap with the snake
    let x: number, y: number;
    do {
      x = Math.floor(Math.random() * this.boardWidth);
      y = Math.floor(Math.random() * this.boardHeight);
    } while (this.snake.some((segment) => segment.x === x && segment.y === y));

    this.food = { x, y };
  }

  private drawGame(client: ConnectedClient): void {
    this.clearScreen(client); // Clear the screen before rendering

    // Create a representation of the game board
    const board: string[][] = Array(this.boardHeight)
      .fill(null)
      .map(() => Array(this.boardWidth).fill(" "));

    // Draw snake
    this.snake.forEach((segment, index) => {
      if (
        segment.x >= 0 &&
        segment.x < this.boardWidth &&
        segment.y >= 0 &&
        segment.y < this.boardHeight
      ) {
        // Head of snake is O, body is o
        board[segment.y][segment.x] = index === 0 ? "O" : "o";
      }
    });

    // Draw food
    if (
      this.food.x >= 0 &&
      this.food.x < this.boardWidth &&
      this.food.y >= 0 &&
      this.food.y < this.boardHeight
    ) {
      board[this.food.y][this.food.x] = "*";
    }

    // Construct the board with simple borders
    let output = "+" + "-".repeat(this.boardWidth) + "+\r\n";

    for (let y = 0; y < this.boardHeight; y++) {
      output += "|";
      for (let x = 0; x < this.boardWidth; x++) {
        const cell = board[y][x];
        if (cell === "O") {
          output += colorize("O", "green"); // Snake head
        } else if (cell === "o") {
          output += colorize("o", "green"); // Snake body
        } else if (cell === "*") {
          output += colorize("*", "red"); // Food
        } else {
          output += " "; // Empty space
        }
      }
      output += "|\r\n";
    }

    output += "+" + "-".repeat(this.boardWidth) + "+\r\n";

    // Show score
    output += colorize(`Score: ${this.score}`, "yellow") + "\r\n";

    // Show game over message if applicable
    if (this.gameOver) {
      output += colorize("\r\nGAME OVER! Press X to exit.", "red") + "\r\n";
    }

    // Simply write the game output instead of clearing screen
    writeToClient(client, output);
  }

  private showInstructions(client: ConnectedClient): void {
    const instructions = [
      colorize("=== SNAKE GAME ===", "bright"),
      colorize("Use WASD or Arrow Keys to move the snake.", "cyan"),
      colorize(
        "Collect the " + colorize("*", "red") + " to grow and score points.",
        "cyan"
      ),
      colorize("Avoid hitting the walls or yourself!", "cyan"),
      colorize("Press X to quit at any time.", "cyan"),
      colorize("Game will start in 3 seconds...", "yellow"),
      "",
    ].join("\r\n");

    writeToClient(client, instructions);
  }

  private startGameLoop(client: ConnectedClient): void {
    // Clear any existing game loop
    if (this.gameLoopId) {
      clearInterval(this.gameLoopId);
    }

    // Notify player that game is starting
    writeToClient(
      client,
      colorize(
        "\r\nSnake game starting now! Move with WASD keys...\r\n",
        "bright"
      )
    );

    // Start a new game loop immediately
    this.gameLoopId = setInterval(() => {
      if (!this.gameOver) {
        this.updateGame(client);
        this.drawGame(client);
      }
    }, this.tickSpeed);
  }

  private updateGame(client: ConnectedClient): void {
    if (this.gameOver) return;

    // Process the next direction in the input queue, if available
    if (this.inputQueue.length > 0) {
      const nextDirection = this.inputQueue.shift();
      if (nextDirection) {
        this.direction = nextDirection;
      }
    }

    // Get current head position
    const head = { ...this.snake[0] };

    // Move head based on direction
    switch (this.direction) {
      case "up":
        head.y--;
        break;
      case "down":
        head.y++;
        break;
      case "left":
        head.x--;
        break;
      case "right":
        head.x++;
        break;
    }

    // Check if the snake hit a wall
    if (
      head.x < 0 ||
      head.x >= this.boardWidth ||
      head.y < 0 ||
      head.y >= this.boardHeight
    ) {
      this.gameOver = true;
      this.showGameOver(client);
      return;
    }

    // Check if snake hit itself
    if (
      this.snake.some((segment) => segment.x === head.x && segment.y === head.y)
    ) {
      this.gameOver = true;
      this.showGameOver(client);
      return;
    }

    // Add new head to snake
    this.snake.unshift(head);

    // Check if snake ate food
    if (head.x === this.food.x && head.y === this.food.y) {
      // Increase score
      this.score += 10;

      // Place new food
      this.placeFood();

      // Speed up game slightly as score increases
      if (this.gameLoopId && this.tickSpeed > 50) {
        clearInterval(this.gameLoopId);
        this.tickSpeed = Math.max(50, this.tickSpeed - 5);
        this.gameLoopId = setInterval(() => {
          if (!this.gameOver) {
            this.updateGame(client);
            this.drawGame(client);
          }
        }, this.tickSpeed);
      }
    } else {
      // Remove tail if snake didn't eat food
      this.snake.pop();
    }
  }

  private endGame(client: ConnectedClient): void {
    // Stop game loop
    if (this.gameLoopId) {
      clearInterval(this.gameLoopId);
      this.gameLoopId = null;
    }

    // Add player back to the game world after finishing snake game
    if (client.user) {
      // Get RoomManager instance with the correct clients map
      const roomManager = RoomManager.getInstance(this.clients);

      // Get the room ID the player was in before playing snake
      const previousRoomId =
        client.stateData.previousRoomId || roomManager.getStartingRoomId();

      // Get the room
      const room = roomManager.getRoom(previousRoomId);
      if (room) {
        // Add the player back to their previous room
        room.addPlayer(client.user.username);
        client.user.currentRoomId = previousRoomId;
        client.user.inCombat = false; // Reset combat state
      }
    }

    // Transition back to previous state
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

  private showHighScores(client: ConnectedClient): void {
    const highScores = this.userManager.getSnakeHighScores(10);

    if (highScores.length === 0) {
      writeToClient(
        client,
        colorize("No high scores recorded yet.\r\n\r\n", "cyan")
      );
      return;
    }

    writeToClient(client, colorize("=== HIGH SCORES ===\r\n", "bright"));

    // Calculate the length needed for username column (at least 15 chars)
    const usernameColWidth = Math.max(
      15,
      ...highScores.map((score) => score.username.length + 2)
    );

    // Display table header
    writeToClient(
      client,
      colorize(
        `${"Rank".padEnd(5)}${"Player".padEnd(usernameColWidth)}Score\r\n`,
        "cyan"
      )
    );
    writeToClient(
      client,
      colorize(`${"-".repeat(5 + usernameColWidth + 10)}\r\n`, "dim")
    );

    // Display high scores
    highScores.forEach((score, index) => {
      const rank = `${index + 1}.`.padEnd(5);
      const player = score.username.padEnd(usernameColWidth);
      const scoreStr = score.score.toString();

      // Highlight the current player's score
      if (client.user && score.username === client.user.username) {
        writeToClient(
          client,
          colorize(`${rank}${player}${scoreStr}\r\n`, "brightYellow")
        );
      } else {
        writeToClient(client, `${rank}${player}${scoreStr}\r\n`);
      }
    });

    writeToClient(client, "\r\n");
  }

  private clearScreen(client: ConnectedClient): void {
    // ANSI escape code to clear the screen and move the cursor to the top-left corner
    writeToClient(client, "\u001b[2J\u001b[H");
  }

  private showGameOver(client: ConnectedClient): void {
    // Stop game loop
    if (this.gameLoopId) {
      clearInterval(this.gameLoopId);
      this.gameLoopId = null;
    }

    // Set game over flag
    this.gameOver = true;

    // Draw final game state
    this.drawGame(client);

    // Show high score screen immediately
    setTimeout(() => {
      this.displayHighScoreScreen(client);
    }, 500); // Short delay so player can see final game state
  }

  private displayHighScoreScreen(client: ConnectedClient): void {
    // Display final score
    writeToClient(client, colors.clear);
    writeToClient(client, colorize("=== GAME OVER ===\r\n", "red"));
    writeToClient(
      client,
      colorize(`Final Score: ${this.score}\r\n\r\n`, "yellow")
    );

    // Save high score
    const username = client.user?.username || "Anonymous";

    let isNewHighScore = false;
    if (client.user) {
      // Check if this is a new personal high score
      if (
        !client.user.snakeHighScore ||
        this.score > client.user.snakeHighScore
      ) {
        isNewHighScore = true;
      }

      // Save the score if it's the user's highest
      this.userManager.saveHighScore({ username, score: this.score });
    }

    // Show a special message if it's a new high score
    if (isNewHighScore) {
      writeToClient(
        client,
        colorize("🏆 NEW PERSONAL HIGH SCORE! 🏆\r\n\r\n", "brightGreen")
      );
    }

    // Display the high scores leaderboard
    this.showHighScores(client);

    // Show instructions to return to the game
    writeToClient(
      client,
      colorize("\r\nPress X to return to the game.", "cyan") + "\r\n"
    );
  }

  exit(client: ConnectedClient): void {
    // Clean up game loop
    if (this.gameLoopId) {
      clearInterval(this.gameLoopId);
      this.gameLoopId = null;
    }
    
    // Clear game state
    this.gameOver = true;
    this.snake = [];
    this.inputQueue = [];
  }
}
