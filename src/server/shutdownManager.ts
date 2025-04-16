import { systemLogger } from '../utils/logger';
import { ClientManager } from '../client/clientManager';
import { createSystemMessageBox } from '../utils/messageFormatter';
import { GameServer } from '../app'; // Import GameServer for shutdown call

export class ShutdownManager {
  private shutdownTimerActive: boolean = false;
  private shutdownTimer: NodeJS.Timeout | null = null;
  private clientManager: ClientManager;
  private gameServer: GameServer; // Reference to the main server instance

  constructor(clientManager: ClientManager, gameServer: GameServer) {
    this.clientManager = clientManager;
    this.gameServer = gameServer;
  }

  public isShutdownActive(): boolean {
    return this.shutdownTimerActive;
  }

  public scheduleShutdown(minutes: number, reason?: string): void {
    // Cancel any existing timer
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
    }
    
    // Set the flag
    this.shutdownTimerActive = true;
    
    // Send a system message to all users notifying them of the shutdown
    const shutdownMessage = reason
      ? `The server will be shutting down in ${minutes} minute${minutes !== 1 ? 's' : ''}: ${reason}`
      : `The server will be shutting down in ${minutes} minute${minutes !== 1 ? 's' : ''}.`;
      
    const boxedMessage = createSystemMessageBox(shutdownMessage);
    
    // Send to all connected users
    for (const client of this.clientManager.getClients().values()) {
      if (client.authenticated) {
        client.connection.write(boxedMessage);
      }
    }
    
    // Log the scheduled shutdown
    systemLogger.info(`Server shutdown scheduled in ${minutes} minutes${reason ? ': ' + reason : ''}.`);
    
    // Create a countdown that sends updates every minute
    let remainingMinutes = minutes;
    
    const updateCountdown = () => {
      remainingMinutes--;
      
      if (remainingMinutes > 0) {
        // Send a reminder if at least one minute remains
        if (remainingMinutes === 1 || remainingMinutes === 2 || remainingMinutes === 5 || 
            remainingMinutes === 10 || remainingMinutes === 15 || remainingMinutes === 30) {
          const reminderMessage = `The server will be shutting down in ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}.`;
          const boxedReminder = createSystemMessageBox(reminderMessage);
          
          for (const client of this.clientManager.getClients().values()) {
            if (client.authenticated) {
              client.connection.write(boxedReminder);
            }
          }
          
          systemLogger.info(`Shutdown reminder: ${remainingMinutes} minutes remaining.`);
        }
        
        // Schedule the next update
        this.shutdownTimer = setTimeout(updateCountdown, 60000); // 1 minute
      } else {
        // Time's up, shut down
        const finalMessage = "The server is shutting down now. Thank you for playing!";
        const boxedFinal = createSystemMessageBox(finalMessage);
        
        for (const client of this.clientManager.getClients().values()) {
          if (client.authenticated) {
            client.connection.write(boxedFinal);
          }
        }
        
        systemLogger.info("Shutdown timer completed. Shutting down server...");
        
        // Give users a moment to see the final message
        setTimeout(() => {
          this.gameServer.shutdown(); // Call shutdown on the main server instance
        }, 2000);
      }
    };
      
    // Start the countdown updates if more than 1 minute
    if (minutes > 0) {
      this.shutdownTimer = setTimeout(updateCountdown, 60000); // Start after 1 minute
    } else {
      // Immediate shutdown if minutes is 0
      updateCountdown();
    }
  }

  public cancelShutdown(): void {
    if (!this.shutdownTimerActive) return;
    
    // Cancel the active shutdown timer
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }
    
    this.shutdownTimerActive = false;
    
    // Send message to all users that shutdown has been aborted
    const abortMessage = "The scheduled server shutdown has been cancelled.";
    const boxedMessage = createSystemMessageBox(abortMessage);
    
    for (const client of this.clientManager.getClients().values()) {
      if (client.authenticated) {
        client.connection.write(boxedMessage);
      }
    }
    
    // Log the abort action
    systemLogger.info('Scheduled shutdown cancelled.');
  }

  public clearShutdownTimer(): void {
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }
    this.shutdownTimerActive = false;
  }
}
