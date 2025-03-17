import { ConnectedClient } from '../types';
import { colorize } from '../utils/colors';
import { writeToClient } from '../utils/socketWriter';

export class CommandHandler {
  private clients: Map<string, ConnectedClient>;
  
  constructor(clients: Map<string, ConnectedClient>) {
    this.clients = clients;
  }

  public handleCommand(client: ConnectedClient, input: string): void {
    if (!client.user) return;
    
    // Ensure input is trimmed
    const cleanInput = input.trim();
    if (cleanInput === '') {
      // Handle empty input gracefully
      return;
    }
    
    const parts = cleanInput.split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ').trim(); // Also trim arguments
    
    switch (command) {
      case 'say':
        this.handleSay(client, args);
        break;
      case 'list':
        this.handleList(client);
        break;
      case 'stats':
        this.handleStats(client);
        break;
      case 'help':
        this.handleHelp(client);
        break;
      default:
        writeToClient(client, colorize(`Unknown command: ${command}\r\n`, 'red'));
        this.handleHelp(client);
    }
  }
  
  private handleSay(client: ConnectedClient, message: string): void {
    if (!client.user) return;
    
    if (!message.trim()) {
      writeToClient(client, colorize('Say what?\r\n', 'yellow'));
      return;
    }
    
    // Send message to all clients
    this.clients.forEach(c => {
      if (c.authenticated && c.user) {
        if (c === client) {
          writeToClient(c, colorize(`You say '${message}'\r\n`, 'green'));
        } else {
          writeToClient(c, colorize(`${client.user!.username} says '${message}'\r\n`, 'cyan'));
        }
      }
    });
  }
  
  private handleList(client: ConnectedClient): void {
    // List all authenticated users
    const users = Array.from(this.clients.values())
      .filter(c => c.authenticated && c.user)
      .map(c => c.user!.username);
    
    writeToClient(client, colorize('=== Online Users ===\r\n', 'magenta'));
    if (users.length === 0) {
      writeToClient(client, colorize('No users online.\r\n', 'yellow'));
    } else {
      users.forEach(username => {
        writeToClient(client, colorize(`- ${username}\r\n`, 'green'));
      });
    }
    writeToClient(client, colorize('===================\r\n', 'magenta'));
  }
  
  private handleStats(client: ConnectedClient): void {
    if (!client.user) return;
    
    const user = client.user;
    writeToClient(client, colorize('=== Your Character Stats ===\r\n', 'magenta'));
    writeToClient(client, colorize(`Username: ${user.username}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Health: ${user.health}/${user.maxHealth}\r\n`, 'green'));
    writeToClient(client, colorize(`Level: ${user.level}\r\n`, 'yellow'));
    writeToClient(client, colorize(`Experience: ${user.experience}\r\n`, 'blue'));
    writeToClient(client, colorize(`Member since: ${user.joinDate.toLocaleDateString()}\r\n`, 'dim'));
    writeToClient(client, colorize(`Last login: ${user.lastLogin.toLocaleDateString()}\r\n`, 'dim'));
    writeToClient(client, colorize('===========================\r\n', 'magenta'));
  }
  
  private handleHelp(client: ConnectedClient): void {
    writeToClient(client, colorize('=== Available Commands ===\r\n', 'bright'));
    writeToClient(client, colorize('say <message> - Send a message to all users\r\n', 'cyan'));
    writeToClient(client, colorize('list - Show online users\r\n', 'cyan'));
    writeToClient(client, colorize('stats - Show your character stats\r\n', 'cyan'));
    writeToClient(client, colorize('help - Show this help message\r\n', 'cyan'));
    writeToClient(client, colorize('==========================\r\n', 'bright'));
  }
}
