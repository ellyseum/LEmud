import http from 'http';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import { systemLogger } from '../utils/logger';
import { ConnectedClient, ServerStats } from '../types';
import * as AdminApi from '../admin/adminApi';
import { UserManager } from '../user/userManager';
import { RoomManager } from '../room/roomManager';
import { GameTimerManager } from '../timer/gameTimerManager';
import config from '../config';

export class APIServer {
  private app: express.Application;
  private httpServer: http.Server;
  private clients: Map<string, ConnectedClient>;
  private userManager: UserManager;
  private roomManager: RoomManager;
  private gameTimerManager: GameTimerManager;
  private serverStats: ServerStats;
  private actualPort: number = config.WS_PORT;

  constructor(
    clients: Map<string, ConnectedClient>,
    userManager: UserManager,
    roomManager: RoomManager,
    gameTimerManager: GameTimerManager,
    serverStats: ServerStats
  ) {
    this.clients = clients;
    this.userManager = userManager;
    this.roomManager = roomManager;
    this.gameTimerManager = gameTimerManager;
    this.serverStats = serverStats;

    // Create the Express app
    this.app = express();
    this.app.use(cors());
    this.app.use(bodyParser.json());

    // Configure API routes
    this.setupApiRoutes();

    // Serve static files
    this.setupStaticFiles();

    // Create the HTTP server with the Express app
    this.httpServer = http.createServer(this.app);

    // Add error handler
    this.httpServer.on('error', (err: Error & {code?: string}) => {
      if (err.code === 'EADDRINUSE') {
        systemLogger.error(`Port ${config.WS_PORT} is already in use. Is another instance running?`);
        systemLogger.info(`Trying alternative port ${config.WS_PORT + 1}...`);
        this.actualPort = config.WS_PORT + 1;
        this.httpServer.listen(this.actualPort);
      } else {
        systemLogger.error('HTTP server error:', err);
      }
    });
  }

  private setupApiRoutes(): void {
    // Admin API routes
    this.app.post('/api/admin/login', AdminApi.login);
    this.app.get('/api/admin/stats', AdminApi.validateToken, AdminApi.getServerStats(this.serverStats));
    this.app.get('/api/admin/players', AdminApi.validateToken, AdminApi.getConnectedPlayers(this.clients, this.userManager));
    this.app.post('/api/admin/players/:clientId/kick', AdminApi.validateToken, AdminApi.kickPlayer(this.clients));
    this.app.post('/api/admin/players/:clientId/monitor', AdminApi.validateToken, AdminApi.monitorPlayer(this.clients));

    // Player management endpoints
    this.app.get('/api/admin/players/all', AdminApi.validateToken, AdminApi.getAllPlayers(this.userManager));
    this.app.get('/api/admin/players/details/:username', AdminApi.validateToken, AdminApi.getPlayerDetailsById(this.userManager));
    this.app.post('/api/admin/players/update/:username', AdminApi.validateToken, AdminApi.updatePlayer(this.userManager, this.roomManager));
    this.app.post('/api/admin/players/reset-password/:username', AdminApi.validateToken, AdminApi.resetPlayerPassword(this.userManager));
    this.app.delete('/api/admin/players/delete/:username', AdminApi.validateToken, AdminApi.deletePlayer(this.userManager, this.roomManager, this.clients));

    // Game timer system endpoints
    this.app.get('/api/admin/gametimer-config', AdminApi.validateToken, AdminApi.getGameTimerConfig(this.gameTimerManager));
    this.app.post('/api/admin/gametimer-config', AdminApi.validateToken, AdminApi.updateGameTimerConfig(this.gameTimerManager));
    this.app.post('/api/admin/force-save', AdminApi.validateToken, AdminApi.forceSave(this.gameTimerManager));

    // MUD config endpoints
    this.app.get('/api/admin/mud-config', AdminApi.validateToken, AdminApi.getMUDConfig());
    this.app.post('/api/admin/mud-config', AdminApi.validateToken, AdminApi.updateMUDConfig());
  }

  private setupStaticFiles(): void {
    // Serve static files from the public directory
    this.app.use(express.static(config.PUBLIC_DIR));

    // Serve xterm.js files from node_modules
    this.app.use('/node_modules', express.static(path.join(__dirname, '..', '..', 'node_modules')));
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(config.WS_PORT, () => {
        const address = this.httpServer.address();
        if (address && typeof address !== 'string') {
          this.actualPort = address.port;
          systemLogger.info(`HTTP server running on port ${address.port}`);
          systemLogger.info(`Admin interface available at http://localhost:${address.port}/admin`);
        } else {
          systemLogger.info(`HTTP server running`);
          systemLogger.info(`Admin interface available`);
        }
        resolve();
      });
    });
  }

  public getHttpServer(): http.Server {
    return this.httpServer;
  }

  public getExpressApp(): express.Application {
    return this.app;
  }

  public getActualPort(): number {
    return this.actualPort;
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.close(() => {
        systemLogger.info('HTTP server stopped');
        resolve();
      });
    });
  }
}