import fs from 'fs';
import path from 'path';
import { UserManager } from '../user/userManager';

// Path to the main admin.json file that contains user admin privileges
const ADMIN_FILE = path.join(__dirname, '..', '..', 'data', 'admin.json');

// Interface for the admin.json file structure
interface AdminData {
  admins: AdminUser[];
}

// Interface for admin users in admin.json
interface AdminUser {
  username: string;
  level: string;
  addedBy: string;
  addedOn: string;
}

export class AdminAuth {
  private admins: AdminUser[] = [];
  private userManager: UserManager;

  constructor() {
    this.userManager = UserManager.getInstance();
    this.loadAdmins();
  }

  private loadAdmins(): void {
    try {
      // Check if the admin.json file exists
      if (!fs.existsSync(ADMIN_FILE)) {
        console.error('Admin file not found:', ADMIN_FILE);
        this.admins = [];
        return;
      }

      const data = fs.readFileSync(ADMIN_FILE, 'utf8');
      const adminData: AdminData = JSON.parse(data);
      this.admins = adminData.admins || [];
    } catch (error) {
      console.error('Error loading admins:', error);
      this.admins = [];
    }
  }

  // Check if a user is an admin (super or admin level, not mod)
  private isAdminOrSuperAdmin(username: string): boolean {
    const admin = this.admins.find(a => a.username.toLowerCase() === username.toLowerCase());
    if (!admin) return false;
    
    // Only allow super and admin levels, not mod
    return admin.level === 'super' || admin.level === 'admin';
  }

  /**
   * Authenticate an admin for web UI access
   * 
   * This checks:
   * 1. If the user exists in users.json
   * 2. If the user has admin or superadmin privileges in admin.json
   * 3. If the password matches the one in users.json
   */
  public authenticate(username: string, password: string): boolean {
    // First check if the user is an admin or super admin in the main system
    if (!this.isAdminOrSuperAdmin(username)) {
      return false;
    }
    
    // Then check if the user exists and the password is correct
    // using the main UserManager authentication
    return this.userManager.authenticateUser(username, password);
  }

  /**
   * Not needed anymore as passwords are managed by UserManager
   * Keeping the method for backward compatibility
   */
  public changePassword(username: string, newPassword: string): boolean {
    // Pass through to the main UserManager
    return this.userManager.changeUserPassword(username, newPassword);
  }
}

// Create a singleton instance
const adminAuth = new AdminAuth();
export default adminAuth;
