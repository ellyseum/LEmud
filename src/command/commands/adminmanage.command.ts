import fs from 'fs';
import path from 'path';
import { ConnectedClient, ItemInstance } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';
import { SudoCommand } from './sudo.command';
import { ItemManager } from '../../utils/itemManager';
import { RoomManager } from '../../room/roomManager';
import { createContextLogger } from '../../utils/logger';

// Create a context-specific logger for AdminManage command
const adminLogger = createContextLogger('AdminManage');
const playerLogger = createContextLogger('Player');

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
  description = 'Grant or revoke admin privileges to players, or manage game items (Admin only)';
  private userManager: UserManager;
  private itemManager: ItemManager;
  private roomManager: RoomManager;
  private sudoCommand: SudoCommand | undefined;
  private adminFilePath: string;
  private admins: AdminUser[] = [];

  constructor(userManager: UserManager) {
    this.userManager = userManager;
    this.itemManager = ItemManager.getInstance();
    
    // We don't have access to clients through UserManager
    // Pass an empty Map as a temporary solution or get the clients from somewhere else
    this.roomManager = RoomManager.getInstance(new Map<string, ConnectedClient>());
    
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
      adminLogger.info(`Loaded ${this.admins.length} admin users`);
    } catch (error) {
      adminLogger.error('Error loading admin users:', error);
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
      adminLogger.info('Saved admin users');
      
      // Ensure the SudoCommand is aware of the updated admin list
      if (this.sudoCommand) {
        this.sudoCommand.updateAdminList(this.admins);
      }
    } catch (error) {
      adminLogger.error('Error saving admin users:', error);
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
    
    // Check if user is an admin
    if (!this.isAdmin(client.user.username) && 
        !this.sudoCommand.isAuthorized(client.user.username)) {
      writeToClient(client, colorize('You do not have permission to use this command.\r\n', 'red'));
      return;
    }

    const parts = args.trim().split(/\s+/);
    const action = parts[0]?.toLowerCase();
    const targetParam = parts[1];
    const level = parts[2]?.toLowerCase() as AdminLevel;

    // Handle different actions
    if (!action || !['list', 'add', 'remove', 'modify', 'destroy', 'summon', 'help'].includes(action)) {
      this.showHelp(client);
      return;
    }

    switch (action) {
      case 'list':
        this.listAdmins(client);
        break;

      case 'add':
        // Require super admin for user management
        if (!this.isSuperAdmin(client.user.username) && 
            !this.sudoCommand.isSuperAdmin(client.user.username)) {
          writeToClient(client, colorize('Error: Only super admins can add new administrators.\r\n', 'red'));
          return;
        }

        if (!targetParam) {
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

        this.addAdmin(client, targetParam, validLevel);
        break;

      case 'remove':
        // Require super admin for user management
        if (!this.isSuperAdmin(client.user.username) && 
            !this.sudoCommand.isSuperAdmin(client.user.username)) {
          writeToClient(client, colorize('Error: Only super admins can remove administrators.\r\n', 'red'));
          return;
        }

        if (!targetParam) {
          writeToClient(client, colorize('Error: Missing username to remove.\r\n', 'red'));
          writeToClient(client, colorize('Usage: adminmanage remove <username>\r\n', 'yellow'));
          return;
        }
        this.removeAdmin(client, targetParam);
        break;

      case 'modify':
        // Require super admin for user management
        if (!this.isSuperAdmin(client.user.username) && 
            !this.sudoCommand.isSuperAdmin(client.user.username)) {
          writeToClient(client, colorize('Error: Only super admins can modify administrators.\r\n', 'red'));
          return;
        }

        if (!targetParam || !level) {
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

        this.modifyAdmin(client, targetParam, newLevel);
        break;

      case 'destroy':
        // All admin levels can destroy items
        if (!targetParam) {
          writeToClient(client, colorize('Error: Missing item instance ID to destroy.\r\n', 'red'));
          writeToClient(client, colorize('Usage: adminmanage destroy <itemInstanceId>\r\n', 'yellow'));
          return;
        }
        this.destroyItem(client, targetParam);
        break;

      case 'summon':
        // All admin levels can summon items/NPCs
        if (!targetParam) {
          writeToClient(client, colorize('Error: Missing ID to summon.\r\n', 'red'));
          writeToClient(client, colorize('Usage: adminmanage summon <id>\r\n', 'yellow'));
          return;
        }
        this.summonEntity(client, targetParam);
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

    adminLogger.info(`Admin ${client.user.username} added new admin ${username} with level ${level}`);
    playerLogger.info(`Player ${username} has been granted ${level} privileges by admin ${client.user.username}`);
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

    adminLogger.info(`Admin ${client.user.username} removed admin ${username}`);
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

      adminLogger.info(`Admin ${client.user.username} modified admin ${username}'s level to ${newLevel}`);
      writeToClient(client, colorize(`${username}'s admin level has been changed to ${newLevel}.\r\n`, 'green'));

      // Notify the target user if they're online
      const targetClient = this.userManager.getActiveUserSession(username);
      if (targetClient) {
        writeToClient(targetClient, colorize(`${client.user.username} has changed your admin level to ${newLevel}.\r\n`, 'yellow'));
      }
    }
  }

  /**
   * Destroy an item instance and remove it from any inventory or room
   */
  private destroyItem(client: ConnectedClient, itemInstanceId: string): void {
    if (!client.user) return;

    // First, check if the item exists with exact match
    let instance = this.itemManager.getItemInstance(itemInstanceId);
    let realInstanceId = itemInstanceId;
    
    // If no exact match and itemInstanceId is at least 8 characters, try partial matching
    if (!instance && itemInstanceId.length >= 8) {
      try {
        // Try to find instance by partial ID
        instance = this.itemManager.findInstanceByPartialId(itemInstanceId);
        
        // If undefined, it means multiple items matched (ambiguous)
        if (instance === undefined) {
          writeToClient(client, colorize(`Multiple items match ID '${itemInstanceId}'. Please use a longer ID to be more specific.\r\n`, 'yellow'));
          
          // Show the matching instances for convenience
          const matchingInstances = this.findInstancesByPartialId(itemInstanceId);
          if (matchingInstances.length > 0) {
            writeToClient(client, colorize(`Matching instances:\r\n`, 'cyan'));
            matchingInstances.forEach((matchInstance, index) => {
              const template = this.itemManager.getItem(matchInstance.templateId);
              const displayName = matchInstance.properties?.customName || (template ? template.name : 'Unknown');
              writeToClient(client, colorize(`  ${index + 1}. ${displayName} (ID: ${matchInstance.instanceId})\r\n`, 'white'));
            });
          }
          return;
        }
        
        if (instance) {
          realInstanceId = instance.instanceId;
        }
      } catch (err) {
        // In case the findInstanceByPartialId method doesn't exist or throws
        adminLogger.error(`Error finding item by partial ID: ${err}`);
        // Continue with normal flow using the original ID
      }
    }
    
    // If we still don't have an instance, it doesn't exist
    if (!instance) {
      writeToClient(client, colorize(`Error: Item with instance ID "${itemInstanceId}" not found.\r\n`, 'red'));
      writeToClient(client, colorize(`For item instances, you can use a partial ID (at least 8 characters).\r\n`, 'yellow'));
      return;
    }

    // Get item name for display
    const displayName = this.itemManager.getItemDisplayName(realInstanceId);
    
    // Check if the item is in any user's inventory and remove it
    let isInUserInventory = false;
    const users = this.userManager.getAllUsers();
    for (const user of users) {
      // Check regular inventory
      if (user.inventory?.items) {
        const itemIndex = user.inventory.items.findIndex(id => id === realInstanceId);
        if (itemIndex !== -1) {
          // Remove from inventory
          user.inventory.items.splice(itemIndex, 1);
          this.userManager.updateUserInventory(user.username, user.inventory);
          writeToClient(client, colorize(`Item removed from ${user.username}'s inventory.\r\n`, 'yellow'));
          isInUserInventory = true;
          
          // Notify the user if they're online
          const targetClient = this.userManager.getActiveUserSession(user.username);
          if (targetClient) {
            writeToClient(
              targetClient, 
              colorize(`Admin ${client.user.username} has destroyed ${displayName} from your inventory.\r\n`, 'red')
            );
          }
        }
      }
      
      // Check equipment slots
      if (user.equipment) {
        for (const [slot, equippedItemId] of Object.entries(user.equipment)) {
          if (equippedItemId === realInstanceId) {
            // Remove from equipment
            delete user.equipment[slot];
            // Use the available method to update user equipment
            this.userManager.updateUserInventory(user.username, user.inventory || { items: [] });
            writeToClient(client, colorize(`Item removed from ${user.username}'s equipment (${slot}).\r\n`, 'yellow'));
            isInUserInventory = true;
            
            // Notify the user if they're online
            const targetClient = this.userManager.getActiveUserSession(user.username);
            if (targetClient) {
              writeToClient(
                targetClient, 
                colorize(`Admin ${client.user.username} has destroyed ${displayName} that you had equipped.\r\n`, 'red')
              );
            }
          }
        }
      }
    }
    
    // Check if the item is in any room and remove it
    let isInRoom = false;
    const rooms = this.roomManager.getAllRooms();
    for (const room of rooms) {
      // Check if item exists in room's itemInstances
      if (room.hasItemInstance(realInstanceId)) {
        // Remove from room using the proper Room method
        room.removeItemInstance(realInstanceId);
        // Update the room
        this.roomManager.updateRoom(room);
        writeToClient(client, colorize(`Item removed from room "${room.id}".\r\n`, 'yellow'));
        isInRoom = true;
      }
      
      // Also check legacy items array for backward compatibility
      if (room.items) {
        const itemIndex = room.items.findIndex((item: any) => {
          // Handle both string IDs and object items
          return (typeof item === 'string' ? item : item.id) === realInstanceId;
        });
        
        if (itemIndex !== -1) {
          // Remove from room
          room.items.splice(itemIndex, 1);
          // Use the updateRoom method 
          this.roomManager.updateRoom(room);
          writeToClient(client, colorize(`Item removed from room's legacy items array "${room.id}".\r\n`, 'yellow'));
          isInRoom = true;
        }
      }
    }
    
    // Add a final history entry
    this.itemManager.addItemHistory(
      realInstanceId,
      'admin-destroy',
      `Forcefully destroyed by admin ${client.user.username}`
    );
    
    // Delete the item instance
    const deleted = this.itemManager.deleteItemInstance(realInstanceId);
    
    if (deleted) {
      writeToClient(client, colorize(`Item "${displayName}" (${realInstanceId}) has been permanently destroyed.\r\n`, 'green'));
      // Log the action
      adminLogger.info(`Admin ${client.user.username} destroyed item ${realInstanceId} (${displayName})`);
    } else {
      writeToClient(client, colorize(`Error: Failed to remove item from database. Please check the logs.\r\n`, 'red'));
    }
  }

  /**
   * Summon an item, NPC, or player to the current room
   */
  private summonEntity(client: ConnectedClient, entityId: string): void {
    if (!client.user) return;
    
    // Get the current room from the client user
    const currentRoomId = client.user.currentRoomId;
    if (!currentRoomId) {
      writeToClient(client, colorize('Error: You are not in a valid room.\r\n', 'red'));
      return;
    }
    
    const room = this.roomManager.getRoom(currentRoomId);
    if (!room) {
      writeToClient(client, colorize(`Error: Room ${currentRoomId} not found.\r\n`, 'red'));
      return;
    }
    
    // First check if it's a player (by username)
    const targetUser = this.userManager.getUser(entityId);
    if (targetUser) {
      // Check if player is already in this room
      if (targetUser.currentRoomId === currentRoomId) {
        writeToClient(client, colorize(`Player ${targetUser.username} is already in this room.\r\n`, 'yellow'));
        return;
      }
      
      // Check if the player is online
      const targetClient = this.userManager.getActiveUserSession(targetUser.username);
      
      // Store the old room ID for messaging
      const oldRoomId = targetUser.currentRoomId;
      const oldRoom = oldRoomId ? this.roomManager.getRoom(oldRoomId) : null;
      
      // Update player's room
      targetUser.currentRoomId = currentRoomId;
      
      // Save the user's new location
      this.userManager.updateUserInventory(targetUser.username, targetUser.inventory || { items: [] });
      
      // Notify all users in the old room if it exists
      if (oldRoomId) {
        // Use simple message method - we'll implement our own broadcasting
        const oldRoomClients = this.getRoomClients(oldRoomId);
        for (const c of oldRoomClients) {
          if (c !== targetClient) { // Don't send to the target user
            writeToClient(c, colorize(`${targetUser.username} suddenly vanishes in a flash of light!\r\n`, 'cyan'));
          }
        }
      }
      
      // Inform the player they've been summoned if they're online
      if (targetClient) {
        writeToClient(
          targetClient,
          colorize(`You feel a powerful force as Admin ${client.user.username} summons you to their location!\r\n`, 'magenta')
        );
        
        // Show the new room to the player if they're online
        if (targetClient.stateData?.commandHandler) {
          targetClient.stateData.commandHandler.handleCommand(targetClient, 'look');
        }
      }
      
      // Announce arrival in new room
      const roomClients = this.getRoomClients(currentRoomId);
      for (const c of roomClients) {
        if (c !== client && c !== targetClient) { // Don't send to admin or target
          writeToClient(c, colorize(`${targetUser.username} appears in the room in a flash of magical energy!\r\n`, 'cyan'));
        }
      }
      
      // Confirm to the admin
      writeToClient(client, colorize(`Player ${targetUser.username} has been summoned to your location.\r\n`, 'green'));
      if (oldRoom) {
        writeToClient(client, colorize(`They were previously in: ${oldRoom.name} (${oldRoomId})\r\n`, 'yellow'));
      } else {
        writeToClient(client, colorize(`They were not in any room previously.\r\n`, 'yellow'));
      }
      
      // Log the action
      adminLogger.info(`Admin ${client.user.username} summoned player ${targetUser.username} to room ${currentRoomId} from ${oldRoomId || 'nowhere'}`);
      
      return;
    }
    
    // Check for an exact item instance match
    let itemInstance = this.itemManager.getItemInstance(entityId);
    
    // If no exact match and it's at least 8 characters, try partial matching
    if (!itemInstance && entityId.length >= 8) {
      try {
        // Try to find instance by partial ID
        itemInstance = this.itemManager.findInstanceByPartialId(entityId);
        
        // If undefined, it means multiple items matched (ambiguous)
        if (itemInstance === undefined) {
          writeToClient(client, colorize(`Multiple items match ID '${entityId}'. Please use a longer ID to be more specific.\r\n`, 'yellow'));
          
          // Show the matching instances for convenience
          const matchingInstances = this.findInstancesByPartialId(entityId);
          if (matchingInstances.length > 0) {
            writeToClient(client, colorize(`Matching instances:\r\n`, 'cyan'));
            matchingInstances.forEach((matchInstance, index) => {
              const template = this.itemManager.getItem(matchInstance.templateId);
              const displayName = matchInstance.properties?.customName || (template ? template.name : 'Unknown');
              writeToClient(client, colorize(`  ${index + 1}. ${displayName} (ID: ${matchInstance.instanceId})\r\n`, 'white'));
            });
          }
          return;
        }
      } catch (err) {
        // In case the findInstanceByPartialId method doesn't exist or throws
        adminLogger.error(`Error finding item by partial ID: ${err}`);
        // Just continue to try other entity types
      }
    }
    
    // If we have an item instance (exact or partial match), handle it
    if (itemInstance) {
      const realInstanceId = itemInstance.instanceId;
      
      // Check if the item already exists in the room using proper Room method
      if (room.hasItemInstance(realInstanceId)) {
        writeToClient(client, colorize(`Item ${realInstanceId} is already in this room.\r\n`, 'yellow'));
        return;
      }
      
      // Get item name for display
      const displayName = this.itemManager.getItemDisplayName(realInstanceId);
      
      // Get the template ID from the item instance
      const templateId = itemInstance.templateId || "unknown";
      
      // IMPORTANT: Find and remove the item from its current location before summoning
      let itemSourceInfo = "unknown location";
      let wasRemoved = false;
      
      // First check all rooms to see if this item is in any of them
      const allRooms = this.roomManager.getAllRooms();
      for (const checkRoom of allRooms) {
        if (checkRoom.id === currentRoomId) continue; // Skip current room
        
        // Check if the room has this item instance
        if (checkRoom.hasItemInstance(realInstanceId)) {
          // Remove the item from this room
          checkRoom.removeItemInstance(realInstanceId);
          this.roomManager.updateRoom(checkRoom);
          
          itemSourceInfo = `room "${checkRoom.name}" (${checkRoom.id})`;
          wasRemoved = true;
          
          // Add to item history
          this.itemManager.addItemHistory(
            realInstanceId,
            'admin-remove',
            `Removed from room ${checkRoom.id} by admin ${client.user.username} (for summoning)`
          );
          
          break; // Item found and removed
        }
      }
      
      // If not found in any room, check player inventories
      if (!wasRemoved) {
        const allUsers = this.userManager.getAllUsers();
        
        for (const user of allUsers) {
          // Check inventory
          if (user.inventory && user.inventory.items && 
              user.inventory.items.includes(realInstanceId)) {
            // Remove from inventory
            user.inventory.items = user.inventory.items.filter(id => id !== realInstanceId);
            this.userManager.updateUserInventory(user.username, user.inventory);
            
            itemSourceInfo = `${user.username}'s inventory`;
            wasRemoved = true;
            
            // Add to item history
            this.itemManager.addItemHistory(
              realInstanceId,
              'admin-remove',
              `Removed from ${user.username}'s inventory by admin ${client.user.username} (for summoning)`
            );
            
            // Notify the user if they're online
            const userClient = this.userManager.getActiveUserSession(user.username);
            if (userClient) {
              writeToClient(
                userClient,
                colorize(`Your ${displayName} vanishes in a flash of light!\r\n`, 'magenta')
              );
            }
            
            break; // Item found and removed
          }
          
          // Check equipment slots
          if (user.equipment) {
            for (const [slot, equippedItemId] of Object.entries(user.equipment)) {
              if (equippedItemId === realInstanceId) {
                // Remove from equipment
                delete user.equipment[slot];
                this.userManager.updateUserInventory(user.username, user.inventory || { items: [] });
                
                itemSourceInfo = `${user.username}'s ${slot} slot`;
                wasRemoved = true;
                
                // Add to item history
                this.itemManager.addItemHistory(
                  realInstanceId,
                  'admin-remove',
                  `Removed from ${user.username}'s ${slot} slot by admin ${client.user.username} (for summoning)`
                );
                
                // Notify the user if they're online
                const userClient = this.userManager.getActiveUserSession(user.username);
                if (userClient) {
                  writeToClient(
                    userClient,
                    colorize(`Your ${displayName} equipped on your ${slot} vanishes in a flash of light!\r\n`, 'magenta')
                  );
                }
                
                break; // Item found and removed
              }
            }
            
            if (wasRemoved) break; // Exit the user loop if item was found
          }
        }
      }
      
      // Now add the item to the current room
      room.addItemInstance(realInstanceId, templateId);
      
      // Update the room
      this.roomManager.updateRoom(room);
      
      // Add to item history
      this.itemManager.addItemHistory(
        realInstanceId, 
        'admin-summon', 
        `Summoned to room ${currentRoomId} by admin ${client.user.username}`
      );
      
      // Notify all users in the room
      const roomClients = this.getRoomClients(currentRoomId);
      for (const c of roomClients) {
        writeToClient(c, colorize(`[ADMIN] ${client.user.username} summons ${displayName} into the room in a flash of light!\r\n`, 'magenta'));
      }
      
      // Confirm to the admin with more details
      writeToClient(client, colorize(`Item "${displayName}" (${realInstanceId}) has been summoned to your location.\r\n`, 'green'));
      
      // If the item was removed from somewhere, notify the admin
      if (wasRemoved) {
        writeToClient(client, colorize(`Item was removed from ${itemSourceInfo}.\r\n`, 'yellow'));
      } else {
        writeToClient(client, colorize(`Item was not found in any room or inventory.\r\n`, 'yellow'));
      }
      
      // Log the action
      adminLogger.info(`Admin ${client.user.username} summoned item ${realInstanceId} (${displayName}) to room ${currentRoomId} from ${itemSourceInfo}`);
      
      return;
    }
    
    // If not an item, check if it's an NPC (simpler implementation)
    try {
      // Try to get the NPC manager if it exists
      const NpcManager = require('../../npc/npcManager').NpcManager;
      const npcManager = NpcManager.getInstance();
      
      const npc = npcManager.getNpc(entityId);
      if (npc) {
        // Initialize npcs based on expected format - looks like it needs to be a Map
        if (!room.npcs) {
          // Initialize as a Map since that's what TypeScript expects
          room.npcs = new Map<string, any>();
        }
        
        // Check if the NPC is already in the room
        let npcAlreadyInRoom = false;
        if (room.npcs instanceof Map) {
          npcAlreadyInRoom = room.npcs.has(entityId);
        }
        
        if (npcAlreadyInRoom) {
          writeToClient(client, colorize(`NPC ${entityId} is already in this room.\r\n`, 'yellow'));
          return;
        }
        
        // Add NPC to the Map
        room.npcs.set(entityId, npc);
        this.roomManager.updateRoom(room);
        
        // Get NPC name for display
        const npcName = npc.name || entityId;
        
        // Notify all users in the room
        const roomClients = this.getRoomClients(currentRoomId);
        for (const c of roomClients) {
          writeToClient(c, colorize(`[ADMIN] ${client.user.username} summons ${npcName} into the room in a shimmer of energy!\r\n`, 'magenta'));
        }
        
        // Log the action
        adminLogger.info(`Admin ${client.user.username} summoned NPC ${entityId} (${npcName}) to room ${currentRoomId}`);
        
        return;
      }
    } catch (error) {
      // NPC manager might not exist or have a different structure
      adminLogger.error(`NPC manager not available or error: ${error}`);
    }
    
    // If we get here, the ID wasn't found as an item, NPC, or player
    writeToClient(client, colorize(`Error: Entity with ID "${entityId}" not found as a player, item, or NPC.\r\n`, 'red'));
    writeToClient(client, colorize(`For items, you can use a partial ID (at least 8 characters).\r\n`, 'yellow'));
    writeToClient(client, colorize(`For players, use their exact username.\r\n`, 'yellow'));
  }

  /**
   * Helper method to get all clients in a room
   */
  private getRoomClients(roomId: string): ConnectedClient[] {
    const result: ConnectedClient[] = [];
    
    const users = this.userManager.getAllUsers();
    for (const user of users) {
      if (user.currentRoomId === roomId) {
        const client = this.userManager.getActiveUserSession(user.username);
        if (client) {
          result.push(client);
        }
      }
    }
    
    return result;
  }

  /**
   * Find all item instances that match a partial ID
   * Used for displaying ambiguous matches
   */
  private findInstancesByPartialId(partialId: string): ItemInstance[] {
    // Ensure the partial ID is at least 8 characters
    if (partialId.length < 8) {
      return [];
    }
    
    const matchingInstances: ItemInstance[] = [];
    const partialIdLower = partialId.toLowerCase();
    
    // Get all instances and filter by ID
    const allInstances = this.itemManager.getAllItemInstances();
    
    for (const instance of allInstances) {
      if (instance.instanceId.toLowerCase().startsWith(partialIdLower)) {
        matchingInstances.push(instance);
      }
    }
    
    return matchingInstances;
  }

  private showHelp(client: ConnectedClient): void {
    writeToClient(client, colorize('=== Admin Management ===\r\n', 'magenta'));
    writeToClient(client, colorize('Usage:\r\n', 'yellow'));
    writeToClient(client, colorize('  adminmanage list - Show all admins\r\n', 'cyan'));
    writeToClient(client, colorize('  adminmanage add <username> [level] - Add a new admin\r\n', 'cyan'));
    writeToClient(client, colorize('  adminmanage remove <username> - Remove an admin\r\n', 'cyan'));
    writeToClient(client, colorize('  adminmanage modify <username> <level> - Change an admin\'s level\r\n', 'cyan'));
    writeToClient(client, colorize('  adminmanage destroy <itemInstanceId> - Destroy an item\r\n', 'cyan'));
    writeToClient(client, colorize('  adminmanage summon <id> - Summon a player, item, or NPC to your room\r\n', 'cyan'));
    writeToClient(client, colorize('\r\nAdmin Levels:\r\n', 'yellow'));
    writeToClient(client, colorize('  super - Can do everything, including managing other admins\r\n', 'red'));
    writeToClient(client, colorize('  admin - Can use all admin commands but can\'t manage other admins\r\n', 'yellow'));
    writeToClient(client, colorize('  mod - Can only use moderation commands\r\n', 'green'));
    writeToClient(client, colorize('=======================\r\n', 'magenta'));
  }
}