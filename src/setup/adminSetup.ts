import path from 'path';
import fs from 'fs';
import { UserManager } from '../user/userManager';
import { readPasswordFromConsole } from '../utils/consoleUtils';
import { AdminLevel } from '../command/commands/adminmanage.command';
import { systemLogger } from '../utils/logger';
import config from '../config';

export class AdminSetup {
  public static async checkAndCreateAdminUser(userManager: UserManager): Promise<boolean> {
    systemLogger.info('Checking for admin user...');
    
    // Check if admin user exists
    if (!userManager.userExists('admin')) {
      // These messages should be shown even in silent mode
      console.log('No admin user found. Creating admin account...');
      console.log('Server startup will halt until admin setup is complete.');
      
      let adminCreated = false;
      
      // Keep trying until the admin is successfully created
      while (!adminCreated) {
        try {
          // Use custom password input that masks the password
          const password = await readPasswordFromConsole('Enter password for new admin user: ');
          
          // Validate password - show this message even in silent mode
          if (password.length < config.MIN_PASSWORD_LENGTH) {
            console.log(`Password must be at least ${config.MIN_PASSWORD_LENGTH} characters long. Please try again.`);
            continue; // Skip the rest of this iteration and try again
          }
          
          // Confirm password with masking
          const confirmPassword = await readPasswordFromConsole('Confirm password: ');
          
          // Check if passwords match - show this message even in silent mode
          if (password !== confirmPassword) {
            console.log('Passwords do not match. Please try again.');
            continue; // Skip the rest of this iteration and try again
          }
          
          // Create admin user
          const success = userManager.createUser('admin', password);
          
          if (success) {
            console.log('Admin user created successfully!');
            
            // Create admin directory if it doesn't exist
            const adminDir = path.join(config.DATA_DIR, 'admin');
            if (!fs.existsSync(adminDir)) {
              fs.mkdirSync(adminDir, { recursive: true });
            }
            
            // Create admin.json file with admin user as super admin
            const adminFilePath = path.join(config.DATA_DIR, 'admin.json');
            const adminData = {
              admins: [
                {
                  username: 'admin',
                  level: AdminLevel.SUPER,
                  addedBy: 'system',
                  addedOn: new Date().toISOString()
                }
              ]
            };
            
            try {
              fs.writeFileSync(adminFilePath, JSON.stringify(adminData, null, 2), 'utf8');
              console.log('Admin privileges configured.');
              systemLogger.info('Admin privileges configured.');
              adminCreated = true; // Mark as successfully created so we exit the loop
            } catch (error) {
              console.log('Error creating admin.json file:', error);
              console.log('Failed to create admin configuration. Please try again.');
              systemLogger.error('Error creating admin.json file:', error);
              systemLogger.warn('Failed to create admin configuration. Please try again.');
              // Continue the loop to try again
            }
          } else {
            console.log('Error creating admin user. Please try again.');
            systemLogger.warn('Error creating admin user. Please try again.');
            // Continue the loop to try again
          }
        } catch (error) {
          console.log('Error during admin setup:', error);
          console.log('An error occurred during setup. Please try again.');
          systemLogger.error('Error during admin setup:', error);
          systemLogger.warn('An error occurred during setup. Please try again.');
          // Continue the loop to try again
        }
      }
      
      return true; // Return true since we don't exit the loop until admin is created
    } else {
      systemLogger.info('Admin user already exists.');
      
      // Ensure admin.json exists with the admin user
      const adminFilePath = path.join(config.DATA_DIR, 'admin.json');
      if (!fs.existsSync(adminFilePath)) {
        systemLogger.warn('Creating admin.json file...');
        
        // Create admin directory if it doesn't exist
        const adminDir = path.join(config.DATA_DIR, 'admin');
        if (!fs.existsSync(adminDir)) {
          fs.mkdirSync(adminDir, { recursive: true });
        }
        
        // Create admin.json with admin user as super admin
        const adminData = {
          admins: [
            {
              username: 'admin',
              level: AdminLevel.SUPER,
              addedBy: 'system',
              addedOn: new Date().toISOString()
            }
          ]
        };
        
        try {
          fs.writeFileSync(adminFilePath, JSON.stringify(adminData, null, 2), 'utf8');
          systemLogger.info('Admin privileges configured.');
        } catch (error) {
          systemLogger.error('Error creating admin.json file:', error);
          return false;
        }
      }
      return true;
    }
  }
}
