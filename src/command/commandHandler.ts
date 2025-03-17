import { ConnectedClient } from '../types';
import { colorize } from '../utils/colors';

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
        client.socket.write(colorize(`Unknown command: ${command}\r\n`, 'red'));
        this.handleHelp(client);
    }
  }
  
  private handleSay(client: ConnectedClient, message: string): void {
    if (!client.user) return;
    
    if (!message.trim()) {
      client.socket.write(colorize('Say what?\r\n', 'yellow'));
      return;
    }
    
    // Send message to all clients
    this.clients.forEach(c => {
      if (c.authenticated && c.user) {
        if (c === client) {
          c.socket.write(colorize(`You say '${message}'\r\n`, 'green'));
        } else {
          c.socket.write(colorize(`${client.user!.username} says '${message}'\r\n`, 'cyan'));
        }
      }
    });
  }
  
  private handleList(client: ConnectedClient): void {
    // List all authenticated users
    const users = Array.from(this.clients.values())
      .filter(c => c.authenticated && c.user)
      .map(c => c.user!.username);
    
    client.socket.write(colorize('=== Online Users ===\r\n', 'magenta'));
    if (users.length === 0) {
      client.socket.write(colorize('No users online.\r\n', 'yellow'));
    } else {
      users.forEach(username => {
        client.socket.write(colorize(`- ${username}\r\n`, 'green'));
      });
    }
    client.socket.write(colorize('===================\r\n', 'magenta'));
  }
  
  private handleStats(client: ConnectedClient): void {
    if (!client.user) return;
    
    const user = client.user;
    client.socket.write(colorize('=== Your Character Stats ===\r\n', 'magenta'));
    client.socket.write(colorize(`Username: ${user.username}\r\n`, 'cyan'));
    client.socket.write(colorize(`Health: ${user.health}/${user.maxHealth}\r\n`, 'green'));
    client.socket.write(colorize(`Level: ${user.level}\r\n`, 'yellow'));
    client.socket.write(colorize(`Experience: ${user.experience}\r\n`, 'blue'));
    client.socket.write(colorize(`Member since: ${user.joinDate.toLocaleDateString()}\r\n`, 'dim'));
    client.socket.write(colorize(`Last login: ${user.lastLogin.toLocaleDateString()}\r\n`, 'dim'));
    client.socket.write(colorize('===========================\r\n', 'magenta'));
  }
  
  private handleHelp(client: ConnectedClient): void {
    client.socket.write(colorize('=== Available Commands ===\r\n', 'bright'));
    client.socket.write(colorize('say <message> - Send a message to all users\r\n', 'cyan'));
    client.socket.write(colorize('list - Show online users\r\n', 'cyan'));
    client.socket.write(colorize('stats - Show your character stats\r\n', 'cyan'));
    client.socket.write(colorize('help - Show this help message\r\n', 'cyan'));
    client.socket.write(colorize('==========================\r\n', 'bright'));
  }
}
