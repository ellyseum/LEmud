// filepath: /workspaces/LEmud/src/utils/debugUtils.ts
import { parseCommandLineArgs } from '../config/cliConfig';

/**
 * A singleton class to track debug mode across the application.
 * Debug mode can be enabled by either:
 * 1. Using the --debug CLI flag when starting the server
 * 2. Having an active local console session (admin or user)
 */
export class DebugModeManager {
    private static instance: DebugModeManager;
    private localSessionActive: boolean = false;
    
    private constructor() {}
    
    /**
     * Get the singleton instance of the DebugModeManager
     */
    public static getInstance(): DebugModeManager {
        if (!DebugModeManager.instance) {
            DebugModeManager.instance = new DebugModeManager();
        }
        return DebugModeManager.instance;
    }
    
    /**
     * Set the local session status
     * @param active Whether a local session is currently active
     */
    public setLocalSessionActive(active: boolean): void {
        this.localSessionActive = active;
    }
    
    /**
     * Check if debug mode is currently enabled
     * @returns true if debug mode is enabled via CLI flag or local session
     */
    public isDebugMode(): boolean {
        // Check for CLI debug flag
        const config = parseCommandLineArgs();
        
        // Debug mode is enabled if either:
        // 1. The --debug CLI flag was used
        // 2. A local session is currently active
        return config.debug || this.localSessionActive;
    }
}

/**
 * Check if debug mode is currently enabled across the application
 * @returns true if debug mode is enabled via CLI flag or local session
 */
export function isDebugMode(): boolean {
    return DebugModeManager.getInstance().isDebugMode();
}