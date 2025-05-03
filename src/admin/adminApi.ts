import { Request, Response } from 'express';
import adminAuth from './adminAuth';
import { ServerStats, ConnectedClient, User } from '../types';
import jwt from 'jsonwebtoken';
import { GameTimerManager } from '../timer/gameTimerManager';
import { UserManager } from '../user/userManager';
import { RoomManager } from '../room/roomManager';
import fs from 'fs';
import path from 'path';

// Secret key for JWT tokens
const JWT_SECRET = process.env.JWT_SECRET || 'mud-admin-secret-key';
const TOKEN_EXPIRY = '1h';

// Configuration file path
const CONFIG_FILE = path.join(__dirname, '..', '..', 'data', 'mud-config.json');

// Default configuration 
const DEFAULT_CONFIG = {
  dataFiles: {
    players: './data/players.json',
    rooms: './data/rooms.json',
    items: './data/items.json',
    npcs: './data/npcs.json'
  },
  game: {
    startingRoom: 'town-square',
    maxPlayers: 100,
    idleTimeout: 30,
    maxPasswordAttempts: 5
  },
  advanced: {
    debugMode: false,
    allowRegistration: true,
    backupInterval: 6,
    logLevel: 'info'
  }
};

/**
 * Get MUD configuration - API handler
 */
export function getMUDConfig() {
  return (req: Request, res: Response) => {
    try {
      const config = loadMUDConfig();
      res.json({ success: true, config });
    } catch (error) {
      console.error('Error getting MUD configuration:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve configuration'
      });
    }
  };
}

/**
 * Update MUD configuration - API handler
 */
export function updateMUDConfig() {
  return (req: Request, res: Response) => {
    try {
      const newConfig = req.body;
      
      // Validate required fields
      if (!newConfig.dataFiles || !newConfig.game || !newConfig.advanced) {
        return res.status(400).json({
          success: false,
          message: 'Missing required configuration sections'
        });
      }
      
      // Save the configuration
      if (saveMUDConfig(newConfig)) {
        res.json({
          success: true,
          message: 'Configuration updated successfully'
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Failed to save configuration'
        });
      }
    } catch (error) {
      console.error('Error updating MUD configuration:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update configuration'
      });
    }
  };
}

export function login(req: Request, res: Response) {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ success: false, message: 'Username and password are required' });
    return;
  }

  const authenticated = adminAuth.authenticate(username, password);
  
  if (authenticated) {
    // Generate JWT token
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
}

export function validateToken(req: Request, res: Response, next: Function) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }
  
  const parts = authHeader.split(' ');
  
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ success: false, message: 'Token error' });
  }
  
  const token = parts[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    (req as any).admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

export function getServerStats(serverStats: ServerStats) {
  return (req: Request, res: Response) => {
    res.json({ success: true, stats: serverStats });
  };
}

export function kickPlayer(clients: Map<string, any>) {
  return (req: Request, res: Response) => {
    const { clientId } = req.params;
    
    if (!clientId) {
      return res.status(400).json({ success: false, message: 'Client ID is required' });
    }
    
    const client = clients.get(clientId);
    
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    
    try {
      // Send a message to the client that they're being kicked by admin
      client.connection.write('\r\n\r\nYou have been disconnected by an administrator.\r\n');
      
      // Disconnect the client
      setTimeout(() => {
        client.connection.end();
      }, 500);
      
      res.json({ success: true, message: 'Player kicked successfully' });
    } catch (error) {
      console.error('Error kicking player:', error);
      res.status(500).json({ success: false, message: 'Failed to kick player' });
    }
  };
}

/**
 * Get connected player details
 */
export function getConnectedPlayers(clients: Map<string, ConnectedClient>, userManager: UserManager) {
  return (req: Request, res: Response) => {
    // Get all connected clients, both authenticated and unauthenticated
    const players = Array.from(clients.entries())
      .map(([id, client]) => {
        const isAuthenticated = client.authenticated && client.user;
        const tempUsername = (client as any).tempUsername; // Handle potential tempUsername property
        
        return {
          id,
          username: isAuthenticated && client.user ? client.user.username : (tempUsername || `Guest-${id.substring(0, 8)}`),
          authenticated: !!isAuthenticated,
          connected: new Date(client.connectedAt).toISOString(),
          ip: client.connection.remoteAddress || 'unknown',
          connectionType: client.connection.getType(),
          currentRoom: isAuthenticated && client.user ? client.user.currentRoomId : 'Not in game',
          health: isAuthenticated && client.user ? `${client.user.health}/${client.user.maxHealth}` : 'N/A',
          level: isAuthenticated && client.user ? client.user.level : 'N/A',
          experience: isAuthenticated && client.user ? client.user.experience : 'N/A',
          lastActivity: client.lastActivity ? new Date(client.lastActivity).toISOString() : 'unknown',
          idleTime: client.lastActivity ? Math.floor((Date.now() - client.lastActivity) / 1000) : 0,
          state: client.state || 'Unknown'
        };
      });
    
    res.json({ success: true, players });
  };
}

export function monitorPlayer(clients: Map<string, any>) {
  return (req: Request, res: Response) => {
    const { clientId } = req.params;
    
    if (!clientId) {
      return res.status(400).json({ success: false, message: 'Client ID is required' });
    }
    
    const client = clients.get(clientId);
    
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    
    try {
      // Get username for response
      const username = client.user ? client.user.username : 'Unknown';
      
      // Set a flag on the client to indicate it's being monitored
      client.isBeingMonitored = true;
      
      res.json({ 
        success: true, 
        message: 'Monitoring session established',
        username: username,
        clientId: clientId
      });
    } catch (error) {
      console.error('Error setting up monitoring:', error);
      res.status(500).json({ success: false, message: 'Failed to set up monitoring' });
    }
  };
}

export function getGameTimerConfig(gameTimerManager: GameTimerManager) {
  return (req: Request, res: Response) => {
    try {
      const config = gameTimerManager.getConfig();
      res.json({ 
        success: true, 
        config
      });
    } catch (error) {
      console.error('Error getting game timer configuration:', error);
      res.status(500).json({ success: false, message: 'Failed to get game timer configuration' });
    }
  };
}

export function updateGameTimerConfig(gameTimerManager: GameTimerManager) {
  return (req: Request, res: Response) => {
    try {
      const { tickInterval, saveInterval } = req.body;
      
      // Validate inputs
      if (tickInterval !== undefined && (isNaN(tickInterval) || tickInterval < 1000)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Tick interval must be at least 1000ms (1 second)'
        });
      }
      
      if (saveInterval !== undefined && (isNaN(saveInterval) || saveInterval < 1)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Save interval must be at least 1 tick'
        });
      }
      
      // Update config with validated values
      const newConfig: any = {};
      if (tickInterval !== undefined) newConfig.tickInterval = tickInterval;
      if (saveInterval !== undefined) newConfig.saveInterval = saveInterval;
      
      gameTimerManager.updateConfig(newConfig);
      
      res.json({ 
        success: true, 
        message: 'Game timer configuration updated successfully',
        config: gameTimerManager.getConfig()
      });
    } catch (error) {
      console.error('Error updating game timer configuration:', error);
      res.status(500).json({ success: false, message: 'Failed to update game timer configuration' });
    }
  };
}

export function forceSave(gameTimerManager: GameTimerManager) {
  return (req: Request, res: Response) => {
    try {
      gameTimerManager.forceSave();
      res.json({ 
        success: true, 
        message: 'Game data saved successfully'
      });
    } catch (error) {
      console.error('Error forcing save:', error);
      res.status(500).json({ success: false, message: 'Failed to save game data' });
    }
  };
}

/**
 * Get all player details (including offline players)
 */
export function getAllPlayers(userManager: UserManager) {
  return (req: Request, res: Response) => {
    try {
      // Get all users from the user manager
      const players = userManager.getAllUsers().map((user: User) => ({
        username: user.username,
        health: user.health,
        maxHealth: user.maxHealth,
        level: user.level,
        experience: user.experience,
        joinDate: user.joinDate,
        lastLogin: user.lastLogin,
        currentRoomId: user.currentRoomId
      }));
      
      res.json({ success: true, players });
    } catch (error) {
      console.error('Error getting all players:', error);
      res.status(500).json({ success: false, message: 'Failed to get player list' });
    }
  };
}

/**
 * Get detailed information about a specific player
 */
export function getPlayerDetailsById(userManager: UserManager) {
  return (req: Request, res: Response) => {
    try {
      const { username } = req.params;
      
      if (!username) {
        return res.status(400).json({ success: false, message: 'Username is required' });
      }
      
      const user = userManager.getUser(username);
      
      if (!user) {
        return res.status(404).json({ success: false, message: 'Player not found' });
      }
      
      res.json({ 
        success: true, 
        player: {
          username: user.username,
          health: user.health,
          maxHealth: user.maxHealth,
          level: user.level,
          experience: user.experience,
          joinDate: user.joinDate,
          lastLogin: user.lastLogin,
          currentRoomId: user.currentRoomId,
          inventory: user.inventory
        }
      });
    } catch (error) {
      console.error('Error getting player details:', error);
      res.status(500).json({ success: false, message: 'Failed to get player details' });
    }
  };
}

/**
 * Update player details
 */
export function updatePlayer(userManager: UserManager, roomManager: RoomManager) {
  return (req: Request, res: Response) => {
    try {
      const { username } = req.params;
      const { health, maxHealth, level, experience, currentRoomId, inventory } = req.body;
      
      if (!username) {
        return res.status(400).json({ success: false, message: 'Username is required' });
      }
      
      // Validate the room ID exists
      if (currentRoomId && !roomManager.getRoom(currentRoomId)) {
        return res.status(400).json({ success: false, message: 'Specified room does not exist' });
      }
      
      // Update the user
      const success = userManager.updateUserStats(username, {
        health,
        maxHealth,
        level,
        experience,
        currentRoomId,
        inventory
      });
      
      if (!success) {
        return res.status(404).json({ success: false, message: 'Player not found' });
      }
      
      // If player is currently online, update their in-memory state too
      const client = userManager.getActiveUserSession(username);
      if (client && client.user) {
        client.user.health = health;
        client.user.maxHealth = maxHealth;
        client.user.level = level;
        client.user.experience = experience;
        
        // Handle room change
        if (currentRoomId && client.user.currentRoomId !== currentRoomId) {
          // Remove from old room
          roomManager.removePlayerFromAllRooms(username);
          
          // Add to new room
          const newRoom = roomManager.getRoom(currentRoomId);
          if (newRoom) {
            newRoom.addPlayer(username);
            client.user.currentRoomId = currentRoomId;
          }
        }
        
        // Update inventory
        if (inventory) {
          client.user.inventory = inventory;
        }
      }
      
      res.json({ success: true, message: 'Player updated successfully' });
    } catch (error) {
      console.error('Error updating player:', error);
      res.status(500).json({ success: false, message: 'Failed to update player' });
    }
  };
}

/**
 * Reset a player's password
 */
export function resetPlayerPassword(userManager: UserManager) {
  return (req: Request, res: Response) => {
    try {
      const { username } = req.params;
      const { newPassword } = req.body;
      
      if (!username || !newPassword) {
        return res.status(400).json({ 
          success: false, 
          message: 'Username and new password are required' 
        });
      }
      
      const user = userManager.getUser(username);
      
      if (!user) {
        return res.status(404).json({ success: false, message: 'Player not found' });
      }
      
      // Update the password
      user.password = newPassword;
      
      // Save the changes
      userManager.forceSave();
      
      res.json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
      console.error('Error resetting password:', error);
      res.status(500).json({ success: false, message: 'Failed to reset password' });
    }
  };
}

/**
 * Delete a player
 */
export function deletePlayer(userManager: UserManager, roomManager: RoomManager, clients: Map<string, ConnectedClient>) {
  return (req: Request, res: Response) => {
    try {
      const { username } = req.params;
      
      if (!username) {
        return res.status(400).json({ success: false, message: 'Username is required' });
      }
      
      // Check if player is online and disconnect them first
      const client = userManager.getActiveUserSession(username);
      if (client) {
        // Send a message to the client that they're being deleted by admin
        client.connection.write('\r\n\r\nYour account has been deleted by an administrator.\r\n');
        
        // Remove from all rooms
        roomManager.removePlayerFromAllRooms(username);
        
        // Unregister the user session
        userManager.unregisterUserSession(username);
        
        // Disconnect after a brief delay
        setTimeout(() => {
          client.connection.end();
        }, 500);
      }
      
      // Delete the user
      const success = userManager.deleteUser(username);
      
      if (!success) {
        return res.status(404).json({ success: false, message: 'Player not found' });
      }
      
      res.json({ success: true, message: 'Player deleted successfully' });
    } catch (error) {
      console.error('Error deleting player:', error);
      res.status(500).json({ success: false, message: 'Failed to delete player' });
    }
  };
}

/**
 * Load the MUD configuration.
 * 
 * @returns {Promise<MUDConfig>} A Promise that resolves to the MUD configuration object.
 */
export async function loadMUDConfig(): Promise<MUDConfig> {
  try {
    // Ensure data directory exists
    const dataDir = path.dirname(CONFIG_FILE);
    await ensureExists(dataDir, true);
    
    // Ensure config file exists
    const configExists = await ensureExists(CONFIG_FILE, false, JSON.stringify(DEFAULT_CONFIG, null, 2));
    if (!configExists) {
      return DEFAULT_CONFIG;
    }
    
    // Read and parse config
    const configData = await fs.promises.readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    console.error('Error loading MUD configuration:', error);
    return DEFAULT_CONFIG;
  }
}

/**
 * Save MUD configuration
 */
export async function saveMUDConfig(config: any): Promise<boolean> {
  try {
    await fs.promises.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving MUD configuration:', error);
    return false;
  }
}
