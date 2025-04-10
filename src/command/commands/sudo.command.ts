// filepath: /Users/jelden/projects/game/src/command/commands/sudo.command.ts
import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';

// Define interface for admin users
interface AdminUser {
  username: string;
  password?: string;
  passwordHash?: string;
  salt?: string;
}

export class SudoCommand implements Command {
  name = 'sudo';
  description = 'Toggle admin access for authorized users';
  private userManager: UserManager;
  private adminUsers: AdminUser[] = [];
  private activeAdmins: Set<string> = new Set(); // Track users with active admin privileges
  
  constructor(userManager: UserManager) {
    this.userManager = userManager;
    this.loadAdminUsers();
  }
  
  private loadAdminUsers(): void {
    try {
      // For security, hardcode initial admin access until proper admin system exists
      this.adminUsers = [
        { username: 'admin' } // Admin always has access
      ];
      
      // In a real implementation, you would load from a secure file
      // this.adminUsers = JSON.parse(fs.readFileSync('/path/to/admins.json', 'utf8'));
      
      console.log('[SudoCommand] Loaded admin users');
    } catch (error) {
      console.error('[SudoCommand] Error loading admin users:', error);
      // Default to just the main admin if file can't be loaded
      this.adminUsers = [{ username: 'admin' }];
    }
  }
  
  /**
   * Check if a user is authorized to use admin commands
   */
  public isAuthorized(username: string): boolean {
    // Special case: admin user always has admin privileges
    if (username === 'admin') return true;
    
    // Check if user has active sudo
    return this.activeAdmins.has(username.toLowerCase());
  }
  
  /**
   * Check if a user can gain admin access
   */
  private canBecomeAdmin(username: string): boolean {
    return this.adminUsers.some(admin => 
      admin.username.toLowerCase() === username.toLowerCase()
    );
  }
  
  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;
    
    const username = client.user.username;
    
    // If user already has admin access
    if (this.isAuthorized(username)) {
      // Special case: admin can't disable their admin status
      if (username === 'admin') {
        writeToClient(client, colorize('You are the admin user and always have admin privileges.\r\n', 'cyan'));
        return;
      }
      
      // Disable admin access
      this.activeAdmins.delete(username.toLowerCase());
      writeToClient(client, colorize('Admin privileges disabled.\r\n', 'yellow'));
      return;
    }
    
    // Check if user is authorized to become admin
    if (!this.canBecomeAdmin(username)) {
      writeToClient(client, colorize('You are not authorized to use this command.\r\n', 'red'));
      return;
    }
    
    // If no password is provided but a command is, execute that command with admin privileges
    if (args && !args.startsWith('-p ')) {
      // Enable admin temporarily for this one command
      this.activeAdmins.add(username.toLowerCase());
      
      // Execute the command
      writeToClient(client, colorize(`Executing with admin privileges: ${args}\r\n`, 'yellow'));
      
      // Get command registry and execute the command
      if (client.stateData && client.stateData.commandHandler) {
        client.stateData.commandHandler.handleCommand(client, args);
      } else {
        writeToClient(client, colorize('Error: Command handler not available.\r\n', 'red'));
      }
      
      // Disable admin privileges after the command
      this.activeAdmins.delete(username.toLowerCase());
      return;
    }
    
    // Enable admin privileges (full sudo mode)
    this.activeAdmins.add(username.toLowerCase());
    writeToClient(client, colorize('Admin privileges enabled. Use "sudo" again to disable.\r\n', 'green'));
    writeToClient(client, colorize('With great power comes great responsibility!\r\n', 'magenta'));
  }
}