import { Request, Response } from 'express';
import adminAuth from './adminAuth';
import { ServerStats } from '../types';
import jwt from 'jsonwebtoken';
import { GameTimerManager } from '../timer/gameTimerManager';

// Secret key for JWT tokens
const JWT_SECRET = process.env.JWT_SECRET || 'mud-admin-secret-key';
const TOKEN_EXPIRY = '1h';

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

export function getPlayerDetails(clients: Map<string, any>, userManager: any) {
  return (req: Request, res: Response) => {
    // Get all connected clients, both authenticated and unauthenticated
    const players = Array.from(clients.entries())
      .map(([id, client]) => {
        const isAuthenticated = client.authenticated && client.user;
        
        return {
          id,
          username: isAuthenticated ? client.user.username : (client.tempUsername || `Guest-${id.substring(0, 8)}`),
          authenticated: !!isAuthenticated,
          connected: new Date(client.connectedAt).toISOString(),
          ip: client.connection.remoteAddress || 'unknown',
          connectionType: client.connection.getType(),
          currentRoom: isAuthenticated ? client.user.currentRoomId : 'Not in game',
          health: isAuthenticated ? `${client.user.health}/${client.user.maxHealth}` : 'N/A',
          level: isAuthenticated ? client.user.level : 'N/A',
          experience: isAuthenticated ? client.user.experience : 'N/A',
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
