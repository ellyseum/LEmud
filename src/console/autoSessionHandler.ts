import { systemLogger } from '../utils/logger';
import { LocalSessionManager } from './localSessionManager';
import { TelnetServer } from '../server/telnetServer';

export class AutoSessionHandler {
    private localSessionManager: LocalSessionManager;
    private telnetServer: TelnetServer;
    private forceSessionUsername: string | null = null;

    constructor(localSessionManager: LocalSessionManager, telnetServer: TelnetServer) {
        this.localSessionManager = localSessionManager;
        this.telnetServer = telnetServer;
    }

    public setForceSessionUsername(username: string | null) {
        this.forceSessionUsername = username;
    }

    public getForceSessionUsername(): string | null {
        return this.forceSessionUsername;
    }

    public async startAutoAdminSession(): Promise<void> {
        // Suppress normal console output for automated sessions
        this.suppressNormalOutput();
        
        // Allow the server a moment to initialize
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Start an admin session
        this.localSessionManager.startLocalAdminSession(this.telnetServer.getActualPort());
        
        // Set up auto-exit when the session ends
        this.setupAutoExit();
    }

    public async startAutoUserSession(): Promise<void> {
        // Suppress normal console output for automated sessions
        this.suppressNormalOutput();
        
        // Allow the server a moment to initialize
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Start a local client session
        this.localSessionManager.startLocalClientSession(this.telnetServer.getActualPort());
        
        // Set up auto-exit when the session ends
        this.setupAutoExit();
    }

    public async startAutoForcedSession(username: string): Promise<void> {
        // Suppress normal console output for automated sessions
        this.suppressNormalOutput();
        
        // Store the username for forced session
        this.forceSessionUsername = username;
        
        // Allow the server a moment to initialize
        await new Promise(resolve => setTimeout(resolve, 100));
        
        try {
            // Start a forced session with the specified username
            await this.localSessionManager.startForcedSession(this.telnetServer.getActualPort(), username);
            
            // Set up auto-exit when the session ends
            this.setupAutoExit();
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            systemLogger.error(`Failed to start forced session as ${username}: ${errorMessage}`);
            process.exit(1); // Exit with error code
        }
    }

    private suppressNormalOutput(): void {
        // Find and remove the console transport permanently for this run
        const winston = require('winston');
        const consoleTransport = systemLogger.transports.find((t: any) => t instanceof winston.transports.Console);
        if (consoleTransport) {
            systemLogger.remove(consoleTransport);
            this.localSessionManager.setOriginalConsoleTransport(consoleTransport);
        }
    }

    private setupAutoExit(): void {
        // Give time for cleanup before exit when session ends
        const originalEndLocalSession = this.localSessionManager.endLocalSession.bind(this.localSessionManager);
        
        // Override the endLocalSession method
        const autoExitEndLocalSession = () => {
            // First call the original method to clean up
            originalEndLocalSession();
            
            // Wait a moment for cleanup, then exit
            setTimeout(() => {
                systemLogger.info('Auto-session ended, shutting down server');
                process.exit(0);
            }, 100);
        };
        
        // Replace the original method with our wrapped version
        this.localSessionManager.endLocalSession = autoExitEndLocalSession;
    }
}