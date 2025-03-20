import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ADMIN_DATA_DIR = path.join(__dirname, '..', '..', 'data', 'admin');
const ADMINS_FILE = path.join(ADMIN_DATA_DIR, 'admins.json');

interface Admin {
  username: string;
  passwordHash: string;
  salt: string;
  lastLogin?: Date;
}

export class AdminAuth {
  private admins: Admin[] = [];

  constructor() {
    this.loadAdmins();
  }

  private loadAdmins(): void {
    try {
      // Create data directory if it doesn't exist
      if (!fs.existsSync(ADMIN_DATA_DIR)) {
        fs.mkdirSync(ADMIN_DATA_DIR, { recursive: true });
      }
      
      // Create admins file if it doesn't exist
      if (!fs.existsSync(ADMINS_FILE)) {
        // Create a default admin account (admin/admin)
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = this.hashPassword('admin', salt);
        
        const defaultAdmin: Admin = {
          username: 'admin',
          passwordHash: hash,
          salt: salt,
          lastLogin: new Date()
        };
        
        fs.writeFileSync(ADMINS_FILE, JSON.stringify([defaultAdmin], null, 2));
        this.admins = [defaultAdmin];
        return;
      }

      const data = fs.readFileSync(ADMINS_FILE, 'utf8');
      this.admins = JSON.parse(data);
      
      // Ensure dates are properly parsed
      this.admins.forEach(admin => {
        if (typeof admin.lastLogin === 'string') {
          admin.lastLogin = new Date(admin.lastLogin);
        }
      });
    } catch (error) {
      console.error('Error loading admins:', error);
      this.admins = [];
    }
  }

  private saveAdmins(): void {
    try {
      fs.writeFileSync(ADMINS_FILE, JSON.stringify(this.admins, null, 2));
    } catch (error) {
      console.error('Error saving admins:', error);
    }
  }

  private hashPassword(password: string, salt: string): string {
    return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  }

  public authenticate(username: string, password: string): boolean {
    const admin = this.admins.find(a => a.username === username);
    if (!admin) return false;
    
    const hash = this.hashPassword(password, admin.salt);
    const match = hash === admin.passwordHash;
    
    if (match) {
      admin.lastLogin = new Date();
      this.saveAdmins();
    }
    
    return match;
  }

  public changePassword(username: string, newPassword: string): boolean {
    const admin = this.admins.find(a => a.username === username);
    if (!admin) return false;
    
    const salt = crypto.randomBytes(16).toString('hex');
    admin.passwordHash = this.hashPassword(newPassword, salt);
    admin.salt = salt;
    
    this.saveAdmins();
    return true;
  }
}

// Create a singleton instance
const adminAuth = new AdminAuth();
export default adminAuth;
