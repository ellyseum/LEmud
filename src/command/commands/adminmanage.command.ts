// filepath: /Users/jelden/projects/game/src/command/commands/adminmanage.command.ts
import fs from 'fs';
import path from 'path';
import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';
import { SudoCommand } from './sudo.command';

// Define admin levels
export enum AdminLevel {
  SUPER = 'super',   // Can do everything, including managing other admins
  ADMIN = 'admin',   // Can use all admin commands but can't manage other admins
  MOD = 'mod'        // Can only use moderation commands
}

// Define admin user structure
export interface AdminUser {
  username: string;
  level: AdminLevel;
  addedBy: string;
  addedOn: string;
}

export class AdminManageCommand implements Command {
  name = 'adminmanage';
  description = 'Grant or revoke admin privileges to players (Super admin only)';
  private userManager: UserManager;
  private sudoCommand: SudoCommand | undefined;
  private adminFilePath: string;
  private admins: AdminUser[] = [];

  constructor(userManager: UserManager) {
    this.userManager = userManager;
    this.adminFilePath = path.join(__dirname, '../../../data/admin.json');
    this.loadAdmins();
  }

  /**
   * Load admin users from the JSON file
   */
  private loadAdmins(): void {
    try {
      if (fs.existsSync(this.adminFilePath)) {
        const data = fs.readFileSync(this.adminFilePath, 'utf8');
        const adminData = JSON.parse(data);
        this.admins = adminData.admins || [];
      } else {
        // Create default admin file if it doesn't exist
        this.admins = [
          {
            username: 'admin',
            level: AdminLevel.SUPER,
            addedBy: 'system',
            addedOn: new Date().toISOString()
          }
        ];
        this.saveAdmins();
      }
      console.log(`[AdminManage] Loaded ${this.admins.length} admin users`);
    } catch (error) {
      console.error('[AdminManage] Error loading admin users:', error);
      // Default to just the main admin if file can't be loaded
      this.admins = [
        {
          username: 'admin',
          level: AdminLevel.SUPER,
          addedBy: 'system',
          addedOn: new Date().toISOString()
        }
      ];
    }

    // Ensure the SudoCommand is aware of the current admin list
    if (this.sudoCommand) {
      this.sudoCommand.updateAdminList(this.admins);
    }
  }

  /**
   * Save admin users to the JSON file
   */
  private saveAdmins(): void {
    try {
      const adminData = { admins: this.admins };
      fs.writeFileSync(this.adminFilePath, JSON.stringify(adminData, null, 2), 'utf8');
      console.log('[AdminManage] Saved admin users');
      
      // Ensure the SudoCommand is aware of the updated admin list
      if (this.sudoCommand) {
        this.sudoCommand.updateAdminList(this.admins);
      }
    } catch (error) {
      console.error('[AdminManage] Error saving admin users:', error);
    }
  }

  /**
   * Set the SudoCommand instance for admin privilege checking
   */
  public setSudoCommand(sudoCommand: SudoCommand): void {
    this.sudoCommand = sudoCommand;
    // Update sudo command with current admin list
    this.sudoCommand.updateAdminList(this.admins);
  }

  /**
   * Check if user is a super admin
   */
  private isSuperAdmin(username: string): boolean {
    const admin = this.admins.find(a => a.username.toLowerCase() === username.toLowerCase());
    return admin?.level === AdminLevel.SUPER;
  }

  /**
   * Check if user is an admin of any level
   */
  private isAdmin(username: string): boolean {
    return this.admins.some(a => a.username.toLowerCase() === username.toLowerCase());
  }

  /**
   * Get admin level for a user
   */
  private getAdminLevel(username: string): AdminLevel | null {
    const admin = this.admins.find(a => a.username.toLowerCase() === username.toLowerCase());
    return admin ? admin.level : null;
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    // Make sure we have a sudo command reference
    if (!this.sudoCommand) {
      if (client.stateData?.commands?.get('sudo')) {
        this.sudoCommand = client.stateData.commands.get('sudo') as SudoCommand;
        this.sudoCommand.updateAdminList(this.admins);
      } else {
        writeToClient(client, colorize('Error: Sudo command not available.\r\n', 'red'));
        return;
      }
    }
    
    // Check if user is a super admin
    if (!this.isSuperAdmin(client.user.username) && 
        !this.sudoCommand.isAuthorized(client.user.username)) {
      writeToClient(client, colorize('You do not have permission to use this command.\r\n', 'red'));
      return;
    }

    const parts = args.trim().split(/\s+/);
    const action = parts[0]?.toLowerCase();
    const targetUsername = parts[1];
    const level = parts[2]?.toLowerCase() as AdminLevel;

    // Handle different actions
    if (!action || !['list', 'add', 'remove', 'modify', 'help'].includes(action)) {
      this.showHelp(client);
      return;
    }

    switch (action) {
      case 'list':
        this.listAdmins(client);
        break;

      case 'add':
        if (!targetUsername) {
          writeToClient(client, colorize('Error: Missing username to add.\r\n', 'red'));
          writeToClient(client, colorize('Usage: adminmanage add <username> [level]\r\n', 'yellow'));
          return;
        }

        // Validate the level
        const validLevel = this.validateLevel(level);
        if (!validLevel) {
          writeToClient(client, colorize(`Invalid admin level: ${level}. Valid levels are: ${Object.values(AdminLevel).join(', ')}\r\n`, 'red'));
          return;
        }

        this.addAdmin(client, targetUsername, validLevel);
        break;

      case 'remove':
        if (!targetUsername) {
          writeToClient(client, colorize('Error: Missing username to remove.\r\n', 'red'));
          writeToClient(client, colorize('Usage: adminmanage remove <username>\r\n', 'yellow'));
          return;
        }
        this.removeAdmin(client, targetUsername);
        break;

      case 'modify':
        if (!targetUsername || !level) {
          writeToClient(client, colorize('Error: Missing username or level.\r\n', 'red'));
          writeToClient(client, colorize('Usage: adminmanage modify <username> <level>\r\n', 'yellow'));
          return;
        }

        // Validate the level
        const newLevel = this.validateLevel(level);
        if (!newLevel) {
          writeToClient(client, colorize(`Invalid admin level: ${level}. Valid levels are: ${Object.values(AdminLevel).join(', ')}\r\n`, 'red'));
          return;
        }

        this.modifyAdmin(client, targetUsername, newLevel);
        break;

      case 'help':
      default:
        this.showHelp(client);
        break;
    }
  }

  private validateLevel(level?: string): AdminLevel | null {
    if (!level) return AdminLevel.MOD; // Default level
    
    // Check if the provided level is valid
    if (Object.values(AdminLevel).includes(level as AdminLevel)) {
      return level as AdminLevel;
    }
    
    return null;
  }

  private listAdmins(client: ConnectedClient): void {
    if (this.admins.length === 0) {
      writeToClient(client, colorize('No admins found.\r\n', 'yellow'));
      return;
    }

    writeToClient(client, colorize('=== Admin Users ===\r\n', 'magenta'));
    
    // Sort by admin level
    const sortedAdmins = [...this.admins].sort((a, b) => {
      const levelOrder = { [AdminLevel.SUPER]: 0, [AdminLevel.ADMIN]: 1, [AdminLevel.MOD]: 2 };
      return levelOrder[a.level] - levelOrder[b.level];
    });
    
    sortedAdmins.forEach(admin => {
      const addedDate = new Date(admin.addedOn).toLocaleDateString();
      writeToClient(client, colorize(`${admin.username} (${admin.level}) - Added by ${admin.addedBy} on ${addedDate}\r\n`, admin.level === AdminLevel.SUPER ? 'red' : admin.level === AdminLevel.ADMIN ? 'yellow' : 'green'));
    });
    
    writeToClient(client, colorize('===================\r\n', 'magenta'));
  }

  private addAdmin(client: ConnectedClient, username: string, level: AdminLevel): void {
    if (!client.user) return;

    // Check if user exists
    const targetUser = this.userManager.getUser(username);
    if (!targetUser) {
      writeToClient(client, colorize(`Error: User "${username}" does not exist.\r\n`, 'red'));
      return;
    }

    // Check if user is already an admin
    if (this.isAdmin(username)) {
      writeToClient(client, colorize(`Error: User "${username}" is already an admin.\r\n`, 'red'));
      return;
    }

    // Check if current user can add admins of this level
    if (client.user.username !== 'admin' && level === AdminLevel.SUPER && this.getAdminLevel(client.user.username) !== AdminLevel.SUPER) {
      writeToClient(client, colorize('Error: Only super admins can add other super admins.\r\n', 'red'));
      return;
    }

    // Add the new admin
    const newAdmin: AdminUser = {
      username,
      level,
      addedBy: client.user.username,
      addedOn: new Date().toISOString()
    };

    this.admins.push(newAdmin);
    this.saveAdmins();

    writeToClient(client, colorize(`${username} has been granted ${level} privileges.\r\n`, 'green'));

    // Notify the target user if they're online
    const targetClient = this.userManager.getActiveUserSession(username);
    if (targetClient) {
      writeToClient(targetClient, colorize(`${client.user.username} has granted you ${level} admin privileges.\r\n`, 'green'));
      writeToClient(targetClient, colorize('You can now use the "sudo" command to activate your admin privileges.\r\n', 'green'));
    }
  }

  private removeAdmin(client: ConnectedClient, username: string): void {
    if (!client.user) return;

    // Cannot remove the main admin
    if (username.toLowerCase() === 'admin') {
      writeToClient(client, colorize('Error: Cannot remove the main admin account.\r\n', 'red'));
      return;
    }

    // Check if user is an admin
    if (!this.isAdmin(username)) {
      writeToClient(client, colorize(`Error: User "${username}" is not an admin.\r\n`, 'red'));
      return;
    }

    // Check permissions - only super admins can remove other admins
    const targetLevel = this.getAdminLevel(username);
    const currentUserLevel = this.getAdminLevel(client.user.username);
    
    if (client.user.username !== 'admin' && 
        (currentUserLevel !== AdminLevel.SUPER || targetLevel === AdminLevel.SUPER)) {
      writeToClient(client, colorize('Error: You do not have permission to remove this admin.\r\n', 'red'));
      return;
    }

    // Remove the admin
    this.admins = this.admins.filter(admin => admin.username.toLowerCase() !== username.toLowerCase());
    this.saveAdmins();

    writeToClient(client, colorize(`${username}'s admin privileges have been revoked.\r\n`, 'green'));

    // Notify the target user if they're online
    const targetClient = this.userManager.getActiveUserSession(username);
    if (targetClient) {
      writeToClient(targetClient, colorize(`${client.user.username} has revoked your admin privileges.\r\n`, 'yellow'));
    }
  }

  private modifyAdmin(client: ConnectedClient, username: string, newLevel: AdminLevel): void {
    if (!client.user) return;

    // Cannot modify the main admin
    if (username.toLowerCase() === 'admin') {
      writeToClient(client, colorize('Error: Cannot modify the main admin account.\r\n', 'red'));
      return;
    }

    // Check if user is an admin
    if (!this.isAdmin(username)) {
      writeToClient(client, colorize(`Error: User "${username}" is not an admin.\r\n`, 'red'));
      return;
    }

    // Check permissions - only super admins can modify other admins
    const currentUserLevel = this.getAdminLevel(client.user.username);
    if (client.user.username !== 'admin' && currentUserLevel !== AdminLevel.SUPER) {
      writeToClient(client, colorize('Error: Only super admins can modify admin privileges.\r\n', 'red'));
      return;
    }

    // Modify the admin level
    const adminIndex = this.admins.findIndex(admin => admin.username.toLowerCase() === username.toLowerCase());
    if (adminIndex !== -1) {
      this.admins[adminIndex].level = newLevel;
      this.saveAdmins();

      writeToClient(client, colorize(`${username}'s admin level has been changed to ${newLevel}.\r\n`, 'green'));

      // Notify the target user if they're online
      const targetClient = this.userManager.getActiveUserSession(username);
      if (targetClient) {
        writeToClient(targetClient, colorize(`${client.user.username} has changed your admin level to ${newLevel}.\r\n`, 'yellow'));
      }
    }
  }

  private showHelp(client: ConnectedClient): void {
    writeToClient(client, colorize('=== Admin Management ===\r\n', 'magenta'));
    writeToClient(client, colorize('Usage:\r\n', 'yellow'));
    writeToClient(client, colorize('  adminmanage list - Show all admins\r\n', 'cyan'));
    writeToClient(client, colorize('  adminmanage add <username> [level] - Add a new admin\r\n', 'cyan'));
    writeToClient(client, colorize('  adminmanage remove <username> - Remove an admin\r\n', 'cyan'));
    writeToClient(client, colorize('  adminmanage modify <username> <level> - Change an admin\'s level\r\n', 'cyan'));
    writeToClient(client, colorize('\r\nAdmin Levels:\r\n', 'yellow'));
    writeToClient(client, colorize('  super - Can do everything, including managing other admins\r\n', 'red'));
    writeToClient(client, colorize('  admin - Can use all admin commands but can\'t manage other admins\r\n', 'yellow'));
    writeToClient(client, colorize('  mod - Can only use moderation commands\r\n', 'green'));
    writeToClient(client, colorize('=======================\r\n', 'magenta'));
  }
}