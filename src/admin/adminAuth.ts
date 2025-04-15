import fs from 'fs';
import path from 'path';
import { UserManager } from '../user/userManager';
import { systemLogger } from '../utils/logger';

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
  // Flag to track if we've already logged the missing file warning
  private static fileWarningLogged: boolean = false;
  // Timestamp when the warning was last logged
  private static warningTimestamp: number = 0;
  // Warning cooldown period in milliseconds (default: 5 minutes)
  private static readonly WARNING_COOLDOWN_MS: number = 5 * 60 * 1000;

  constructor() {
    this.userManager = UserManager.getInstance();
    this.loadAdmins();
  }

  private loadAdmins(): void {
    try {
      // Check if the admin.json file exists
      if (!fs.existsSync(ADMIN_FILE)) {
        const currentTime = Date.now();
        
        // Only log the warning if the cooldown period has passed
        if (!AdminAuth.fileWarningLogged || 
            (currentTime - AdminAuth.warningTimestamp) > AdminAuth.WARNING_COOLDOWN_MS) {
          systemLogger.warn(`Admin file not found: ${ADMIN_FILE}`);
          AdminAuth.fileWarningLogged = true;
          AdminAuth.warningTimestamp = currentTime;
        }
        this.admins = [];
        return;
      }

      const data = fs.readFileSync(ADMIN_FILE, 'utf8');
      const adminData: AdminData = JSON.parse(data);
      this.admins = adminData.admins || [];
    } catch (error) {
      systemLogger.error(`Error loading admins: ${error}`);
      this.admins = [];
    }
  }

  // Method to clear the warning flag if needed
  static resetWarningFlag(): void {
    AdminAuth.fileWarningLogged = false;
    AdminAuth.warningTimestamp = 0;
  }

  // Method to set warning cooldown period if needed
  static setWarningCooldown(cooldownTimeMs: number): void {
    // Prevent setting invalid values
    if (cooldownTimeMs > 0) {
      Object.defineProperty(AdminAuth, 'WARNING_COOLDOWN_MS', {
        value: cooldownTimeMs
      });
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
