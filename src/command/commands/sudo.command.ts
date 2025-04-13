import fs from 'fs';
import path from 'path';
import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { AdminLevel, AdminUser } from './adminmanage.command';
// Import drawCommandPrompt to force prompt redraw
import { drawCommandPrompt } from '../../utils/promptFormatter';
import { CommandRegistry } from '../commandRegistry';

export class SudoCommand implements Command {
  name = 'sudo';
  description = 'Toggle admin access for authorized users';
  private adminUsers: AdminUser[] = [];
  private static activeAdmins: Set<string> = new Set(); // Track users with active admin privileges
  private adminFilePath: string;
  private static commandRegistry: CommandRegistry | null = null;

  // Singleton instance
  private static instance: SudoCommand | null = null;

  /**
   * Get the singleton instance of SudoCommand
   */
  public static getInstance(): SudoCommand {
    if (!SudoCommand.instance) {
      SudoCommand.instance = new SudoCommand();
    }
    return SudoCommand.instance;
  }

  /**
   * Set the command registry for executing commands
   */
  public setCommandRegistry(registry: CommandRegistry): void {
    SudoCommand.commandRegistry = registry;
  }

  private constructor() {
    this.adminFilePath = path.join(__dirname, '../../../data/admin.json');
    this.loadAdminUsers();
  }

  // Add static helper methods for external admin status checking

  /**
   * Check if a user has admin privileges (static method for easy access)
   */
  public static isAuthorizedUser(username: string): boolean {
    // Special case: admin user always has admin privileges
    if (username.toLowerCase() === 'admin') return true;

    // Check if user has active sudo
    return SudoCommand.activeAdmins.has(username.toLowerCase());
  }

  /**
   * Check if a user is a super admin
   */
  public isSuperAdmin(username: string): boolean {
    // Special case: admin user is always a super admin
    if (username.toLowerCase() === 'admin') return true;

    // Get the admin user from the list
    const admin = this.adminUsers.find(admin => 
      admin.username.toLowerCase() === username.toLowerCase()
    );
    
    // Check if the user is a super admin
    return admin?.level === AdminLevel.SUPER && SudoCommand.activeAdmins.has(username.toLowerCase());
  }

  /**
   * Load admin users from JSON file
   */
  private loadAdminUsers(): void {
    try {
      if (fs.existsSync(this.adminFilePath)) {
        const data = fs.readFileSync(this.adminFilePath, 'utf8');
        const adminData = JSON.parse(data);
        this.adminUsers = adminData.admins || [];
      } else {
        // Create default admin file if it doesn't exist
        this.adminUsers = [
          {
            username: 'admin',
            level: AdminLevel.SUPER,
            addedBy: 'system',
            addedOn: new Date().toISOString()
          }
        ];
        this.saveAdmins();
      }
      console.log(`[SudoCommand] Loaded ${this.adminUsers.length} admin users`);
    } catch (error) {
      console.error('[SudoCommand] Error loading admin users:', error);
      // Default to just the main admin if file can't be loaded
      this.adminUsers = [
        {
          username: 'admin',
          level: AdminLevel.SUPER,
          addedBy: 'system',
          addedOn: new Date().toISOString()
        }
      ];
    }
  }

  /**
   * Save admin users to JSON file
   */
  private saveAdmins(): void {
    try {
      const adminData = { admins: this.adminUsers };
      fs.writeFileSync(this.adminFilePath, JSON.stringify(adminData, null, 2), 'utf8');
      console.log('[SudoCommand] Saved admin users');
    } catch (error) {
      console.error('[SudoCommand] Error saving admin users:', error);
    }
  }

  /**
   * Update admin list from adminmanage command
   */
  public updateAdminList(admins: AdminUser[]): void {
    this.adminUsers = admins;
    console.log(`[SudoCommand] Updated admin list with ${this.adminUsers.length} users`);
  }

  /**
   * Check if a user is authorized to use admin commands
   */
  public isAuthorized(username: string): boolean {
    return SudoCommand.isAuthorizedUser(username);
  }

  /**
   * Check if a user can gain admin access
   */
  private canBecomeAdmin(username: string): boolean {
    return this.adminUsers.some(admin => 
      admin.username.toLowerCase() === username.toLowerCase()
    );
  }

  /**
   * Get the admin level for a user
   */
  public getAdminLevel(username: string): AdminLevel | null {
    const admin = this.adminUsers.find(admin => 
      admin.username.toLowerCase() === username.toLowerCase()
    );
    return admin ? admin.level : null;
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    const username = client.user.username;

    // If user already has admin access
    if (this.isAuthorized(username)) {
      // Special case: admin can't disable their admin status
      if (username.toLowerCase() === 'admin') {
        writeToClient(client, colorize('You are the admin user and always have admin privileges.\r\n', 'cyan'));
        return;
      }

      // Disable admin access
      SudoCommand.activeAdmins.delete(username.toLowerCase());
      writeToClient(client, colorize('Admin privileges disabled.\r\n', 'yellow'));

      // Force prompt redraw to update admin status in prompt
      drawCommandPrompt(client);
      return;
    }

    // Check if user is authorized to become admin
    if (!this.canBecomeAdmin(username)) {
      writeToClient(client, colorize('You are not authorized to use this command.\r\n', 'red'));
      writeToClient(client, colorize('You need to be granted admin privileges first.\r\n', 'red'));
      return;
    }

    // Get the admin level
    const adminLevel = this.getAdminLevel(username);
    if (!adminLevel) {
      writeToClient(client, colorize('Error: Admin level not found.\r\n', 'red'));
      return;
    }

    // If a command is provided, execute it with admin privileges
    if (args && !args.startsWith('-p ')) {
      // Enable admin temporarily for this one command
      SudoCommand.activeAdmins.add(username.toLowerCase());

      // Execute the command
      writeToClient(client, colorize(`Executing with ${adminLevel} privileges: ${args}\r\n`, 'yellow'));

      // Use the command registry directly if available
      if (SudoCommand.commandRegistry) {
        SudoCommand.commandRegistry.executeCommand(client, args);
      }
      // Fallback to client's commandHandler if available
      else if (client.stateData && client.stateData.commandHandler) {
        client.stateData.commandHandler.handleCommand(client, args);
      } 
      // Neither is available, show error
      else {
        writeToClient(client, colorize('Error: Command handler not available.\r\n', 'red'));
      }

      // Disable admin privileges after the command
      SudoCommand.activeAdmins.delete(username.toLowerCase());
      return;
    }

    // Enable admin privileges (full sudo mode)
    SudoCommand.activeAdmins.add(username.toLowerCase());
    writeToClient(client, colorize(`${adminLevel.toUpperCase()} privileges enabled. Use "sudo" again to disable.\r\n`, 'green'));

    // Show different message based on admin level
    switch (adminLevel) {
      case AdminLevel.SUPER:
        writeToClient(client, colorize('You now have SUPER ADMIN access. You can do anything, including managing other admins.\r\n', 'red'));
        break;
      case AdminLevel.ADMIN:
        writeToClient(client, colorize('You now have ADMIN access. You can use all admin commands except managing other admins.\r\n', 'yellow'));
        break;
      case AdminLevel.MOD:
        writeToClient(client, colorize('You now have MODERATOR access. You can use moderation commands.\r\n', 'green'));
        break;
    }

    writeToClient(client, colorize('With great power comes great responsibility!\r\n', 'magenta'));

    // Force prompt redraw to update admin status in prompt
    drawCommandPrompt(client);
  }
}