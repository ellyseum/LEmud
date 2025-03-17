import fs from 'fs';
import path from 'path';
import { User } from '../types';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

export class UserManager {
  private users: User[] = [];

  constructor() {
    this.loadUsers();
  }

  private loadUsers(): void {
    try {
      // Create data directory if it doesn't exist
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      
      // Create users file if it doesn't exist
      if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
        return;
      }

      const data = fs.readFileSync(USERS_FILE, 'utf8');
      this.users = JSON.parse(data);
      
      // Ensure dates are properly parsed
      this.users.forEach(user => {
        if (typeof user.joinDate === 'string') {
          user.joinDate = new Date(user.joinDate);
        }
        if (typeof user.lastLogin === 'string') {
          user.lastLogin = new Date(user.lastLogin);
        }
      });
    } catch (error) {
      console.error('Error loading users:', error);
      this.users = [];
    }
  }

  private saveUsers(): void {
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(this.users, null, 2));
    } catch (error) {
      console.error('Error saving users:', error);
    }
  }

  public getUser(username: string): User | undefined {
    return this.users.find(user => user.username.toLowerCase() === username.toLowerCase());
  }

  public userExists(username: string): boolean {
    return this.users.some(user => user.username.toLowerCase() === username.toLowerCase());
  }

  public authenticateUser(username: string, password: string): boolean {
    const user = this.getUser(username);
    return user !== undefined && user.password === password;
  }

  public createUser(username: string, password: string): boolean {
    if (this.userExists(username)) {
      return false;
    }

    const now = new Date();
    const newUser: User = {
      username,
      password,
      health: 100,
      maxHealth: 100,
      experience: 0,
      level: 1,
      joinDate: now,
      lastLogin: now
    };

    this.users.push(newUser);
    this.saveUsers();
    return true;
  }

  public updateLastLogin(username: string): void {
    const user = this.getUser(username);
    if (user) {
      user.lastLogin = new Date();
      this.saveUsers();
    }
  }

  public updateUserStats(username: string, stats: Partial<User>): boolean {
    const user = this.getUser(username);
    if (!user) return false;
    
    Object.assign(user, stats);
    this.saveUsers();
    return true;
  }
}
