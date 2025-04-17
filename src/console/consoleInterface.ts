import { GameServer } from '../app';
import { ShutdownManager } from '../server/shutdownManager';
import { systemLogger } from '../utils/logger';
import { createSystemMessageBox } from '../utils/messageFormatter';
import { ClientManager } from '../client/clientManager';
import readline from 'readline';
import config from '../config';

export class ConsoleInterface {
    private gameServer: GameServer;
    private shutdownManager: ShutdownManager;
    private clientManager: ClientManager;
    private mainKeyListener: ((key: string) => void) | null = null;
    private onKeyCommand: (command: string) => void;

    constructor(
        gameServer: GameServer,
        shutdownManager: ShutdownManager,
        clientManager: ClientManager,
        onKeyCommand: (command: string) => void
    ) {
        this.gameServer = gameServer;
        this.shutdownManager = shutdownManager;
        this.clientManager = clientManager;
        this.onKeyCommand = onKeyCommand;
    }

    public setupKeyListener(): void {
        // Only set up keyboard shortcuts if we're in a TTY and console mode isn't explicitly disabled
        if (config.CONSOLE_MODE) {
            this.logWelcomeMessage();
            
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
                process.stdin.resume();
                process.stdin.setEncoding('utf8');
        
                // Define the key listener function
                this.mainKeyListener = (key: string) => {
                    const lowerKey = key.toLowerCase();

                    // Forward the keypress to the registered handler
                    // Add 'h' to the list of handled keys
                    if (['l', 'a', 'u', 'm', 's', 'q', 'h', '?'].includes(lowerKey)) {
                        // Handle 'h' and '?' specifically for help
                        if (lowerKey === 'h' || lowerKey === '?') {
                            this.displayHelpMessage();
                        } else {
                            this.onKeyCommand(lowerKey);
                        }
                    } else if (key === '\u0003') { // Ctrl+C
                        systemLogger.info('Ctrl+C detected. Shutting down server...');
                        this.gameServer.shutdown();
                    } else {
                        // Show help message for unrecognized keys
                        if (key.length === 1 && key.charCodeAt(0) >= 32 && key.charCodeAt(0) <= 126) {
                            console.log(`\nUnrecognized option: '${key}'`);
                            this.displayHelpMessage(); // Show full help on error
                        }
                    }
                };
        
                // Attach the listener
                process.stdin.on('data', this.mainKeyListener);
            } else {
                systemLogger.info('Not running in a TTY, local client connection disabled.');
            }
        } else if (config.NO_CONSOLE && process.stdout.isTTY) {
            // If console commands are explicitly disabled, set up only a minimal Ctrl+C handler
            // for graceful shutdown, but no other keyboard shortcuts
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.setEncoding('utf8');
            
            const minimalKeyListener = (key: string) => {
                // Only handle Ctrl+C
                if (key === '\u0003') {
                    systemLogger.info('Ctrl+C detected. Shutting down server...');
                    this.gameServer.shutdown();
                }
            };
            
            process.stdin.on('data', minimalKeyListener);
        }
    }

    public removeMainKeyListener(): void {
        if (this.mainKeyListener) {
            process.stdin.removeListener('data', this.mainKeyListener);
            this.mainKeyListener = null;
        }
    }

    public logWelcomeMessage(): void {
        if (config.IS_TTY) {
            console.log('========================================');
            console.log('           MUD SERVER STARTED          ');
            console.log('========================================');
            console.log(`Press 'l' to connect locally, 'a' for admin session`);
            console.log(`Press 'u' for users, 'm' to monitor, 's' for message`);
            console.log(`Press 'q' to shutdown, 'h' or '?' for help`);
            console.log('========================================');
        }
    }

    private displayHelpMessage(): void {
        console.log("\n=== Console Commands Help ===");
        console.log("  l : Connect Locally   - Start a new local game session.");
        console.log("  a : Admin Session     - Start a local admin session (requires admin user).");
        console.log("  u : User Admin Menu   - Open the user management interface.");
        console.log("  m : Monitor User      - Monitor an active user's session.");
        console.log("  s : System Message    - Send a broadcast message to all online users.");
        console.log("  q : Shutdown Server   - Show options for shutting down the MUD server.");
        console.log("  h,? : Help            - Display this help message.");
        console.log("  Ctrl+C : Shutdown    - Immediately shut down the MUD server.");
        console.log("===========================");
    }

    public sendSystemMessage(): void {
        // Remove the main key listener temporarily
        this.removeMainKeyListener();
        process.stdin.removeAllListeners('data');
        
        // Pause console logging temporarily
        const winston = require('winston');
        let messageConsoleTransport: any = null;
        const consoleTransport = systemLogger.transports.find((t: any) => t instanceof winston.transports.Console);
        if (consoleTransport) {
            messageConsoleTransport = consoleTransport;
            systemLogger.remove(messageConsoleTransport);
            console.log("\nConsole logging paused. Enter your system message:");
        }
        
        // Temporarily remove raw mode to get text input
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
        
        console.log("\n=== System Message ===");
        console.log("Enter message to broadcast to all users (press Enter when done, Ctrl+C to cancel):");
        
        // Create a readline interface for getting user input
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.on('SIGINT', () => {
            rl.close();
            console.log("\nSystem message cancelled.");
            // Restore console logging
            if (messageConsoleTransport) {
                systemLogger.add(messageConsoleTransport);
                systemLogger.info('Console logging restored.');
            }
            // Restore main key listener
            this.setupKeyListener();
        });
        
        // Get the system message
        rl.question('> ', (message) => {
            rl.close(); // Close readline interface
            
            if (message.trim()) {
                console.log("\nSending system message to all users...");
                
                // Create the boxed system message
                const boxedMessage = createSystemMessageBox(message);
                
                // Send to all clients
                let sentCount = 0;
                this.clientManager.getClients().forEach(client => {
                    if (client.authenticated) {
                        client.connection.write(boxedMessage);
                        sentCount++;
                    }
                });
                
                console.log(`Message sent to ${sentCount} users.`);
                
                // Log after we restore the transport so it will appear in the log file
                if (messageConsoleTransport) {
                    systemLogger.add(messageConsoleTransport); // Restore transport first
                    systemLogger.info('Console logging restored.');
                    systemLogger.info(`System message broadcast: "${message}"`);
                } else {
                    systemLogger.info(`System message broadcast: "${message}"`);
                }
            } else {
                console.log("Message was empty, not sending.");
                
                // Restore console logging if it was paused
                if (messageConsoleTransport) {
                    systemLogger.add(messageConsoleTransport);
                    systemLogger.info('Console logging restored.');
                }
            }
            
            // Restore main key listener
            this.setupKeyListener();
        });
    }

    public showShutdownOptions(): void {
        // Remove the main key listener temporarily
        this.removeMainKeyListener();
        process.stdin.removeAllListeners('data');
        
        // Pause console logging
        const winston = require('winston');
        let shutdownConsoleTransport: any = null;
        const consoleTransport = systemLogger.transports.find((t: any) => t instanceof winston.transports.Console);
        if (consoleTransport) {
            shutdownConsoleTransport = consoleTransport;
            systemLogger.remove(shutdownConsoleTransport);
        }
        
        console.log("\n=== Shutdown Options ===");
        console.log("  q: Shutdown immediately");
        console.log("  m: Shutdown with message");
        console.log("  t: Shutdown timer");
        // Show abort option only if a shutdown timer is active
        if (this.shutdownManager.isShutdownActive()) {
            console.log("  a: Abort current shutdown");
        }
        console.log("  c: Cancel");
        console.log("Ctrl+C: Cancel");
        
        // Create a special key handler for the shutdown menu
        const shutdownMenuHandler = (shutdownKey: string) => {
            const shutdownOption = shutdownKey.toLowerCase();
            
            if (shutdownKey === '\u0003' || shutdownOption === 'c') {
                // Ctrl+C or 'c' cancels
                this.cancelShutdownAndRestoreLogging(shutdownConsoleTransport);
                return;
            }
            else if (shutdownOption === 'q') {
                // Immediate shutdown
                console.log("\nShutting down server by request...");
                process.stdin.removeListener('data', shutdownMenuHandler); // Remove listener before shutdown
                // Restore logging before shutting down so shutdown messages are logged
                if (shutdownConsoleTransport) {
                    systemLogger.add(shutdownConsoleTransport);
                }
                this.gameServer.shutdown();
            } 
            else if (shutdownOption === 't') {
                // Remove the shutdown menu handler
                process.stdin.removeListener('data', shutdownMenuHandler);
                
                // Set initial timer value
                let shutdownMinutes = 5;
                
                // Show timer input
                this.showShutdownTimerPrompt(shutdownMinutes);
                
                // Handle timer value changes
                const timerInputHandler = (timerKey: string) => {
                    if (timerKey === '\u0003' || timerKey.toLowerCase() === 'c') {
                        // Ctrl+C or 'c' cancels timer input
                        process.stdin.removeListener('data', timerInputHandler);
                        this.cancelShutdownAndRestoreLogging(shutdownConsoleTransport);
                    }
                    else if (timerKey === '\r' || timerKey === '\n') {
                        // Enter confirms the timer
                        process.stdin.removeListener('data', timerInputHandler);
                        
                        // Start the shutdown timer using ShutdownManager
                        this.shutdownManager.scheduleShutdown(shutdownMinutes);
                        
                        // Restore logging and main key listener
                        if (shutdownConsoleTransport) {
                            systemLogger.add(shutdownConsoleTransport);
                            systemLogger.info(`Console logging restored. Server will shutdown in ${shutdownMinutes} minutes.`);
                        }
                        
                        // Restore main key listener
                        this.setupKeyListener();
                    }
                    // Handle arrow keys for adjusting the time value
                    else if (timerKey === '\u001b[A' || timerKey === '\u001bOA') { // Up arrow
                        shutdownMinutes = Math.min(999, shutdownMinutes + 1);
                        this.showShutdownTimerPrompt(shutdownMinutes);
                    }
                    else if (timerKey === '\u001b[B' || timerKey === '\u001bOB') { // Down arrow
                        shutdownMinutes = Math.max(0, shutdownMinutes - 1);
                        this.showShutdownTimerPrompt(shutdownMinutes);
                    }
                };
                
                // Listen for timer input
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(true); // Ensure raw mode for arrow keys
                }
                process.stdin.resume();
                process.stdin.on('data', timerInputHandler);
            }
            else if (shutdownOption === 'm') {
                // Remove the shutdown menu handler
                process.stdin.removeListener('data', shutdownMenuHandler);
                
                // Temporarily remove raw mode to get text input
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(false);
                }
                
                console.log("\n=== Shutdown with Message ===");
                console.log("Enter message to send to all users before shutdown (Ctrl+C to cancel):");
                
                // Create a readline interface for getting user input
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });

                rl.on('SIGINT', () => {
                    rl.close();
                    console.log("\nShutdown with message cancelled.");
                    this.cancelShutdownAndRestoreLogging(shutdownConsoleTransport);
                });
                
                // Get the shutdown message
                rl.question('> ', (message) => {
                    rl.close();
                    
                    // Restore logging immediately after getting input
                    if (shutdownConsoleTransport) {
                        systemLogger.add(shutdownConsoleTransport);
                        systemLogger.info('Console logging restored.');
                    }

                    if (message.trim()) {
                        console.log("\nSending message and shutting down server...");
                        
                        // Create the boxed system message
                        const boxedMessage = createSystemMessageBox(message);
                        
                        // Send to all connected users
                        let sentCount = 0;
                        this.clientManager.getClients().forEach(client => {
                            if (client.authenticated) {
                                client.connection.write(boxedMessage);
                                sentCount++;
                            }
                        });
                        
                        console.log(`Message sent to ${sentCount} users.`);
                        
                        // Log the message
                        systemLogger.info(`Shutdown message broadcast: "${message}"`);
                        
                        // Give users a moment to read the message, then shutdown
                        console.log("Shutting down in 5 seconds...");
                        setTimeout(() => {
                            this.gameServer.shutdown();
                        }, 5000);
                    } else {
                        console.log("Message was empty. Proceeding with immediate shutdown...");
                        this.gameServer.shutdown();
                    }
                    // No need to restore key listener here, shutdown is imminent
                });
            }
            else if (shutdownOption === 'a' && this.shutdownManager.isShutdownActive()) {
                // Abort the current shutdown timer
                console.log("\nAborting current shutdown timer...");
                this.shutdownManager.cancelShutdown();
                
                // Restore console logging
                if (shutdownConsoleTransport) {
                    systemLogger.add(shutdownConsoleTransport);
                    systemLogger.info('Console logging restored. Shutdown timer aborted.');
                }
                
                // Clean up and restore main key listener
                process.stdin.removeListener('data', shutdownMenuHandler);
                this.setupKeyListener();
            }
            else {
                // Any other key - just redisplay the options
                console.log(`\nUnrecognized option (${shutdownOption})`);
                console.log("\n=== Shutdown Options ===");
                console.log("  q: Shutdown immediately");
                console.log("  m: Shutdown with message");
                console.log("  t: Shutdown timer");
                if (this.shutdownManager.isShutdownActive()) {
                    console.log("  a: Abort current shutdown");
                }
                console.log("  c: Cancel");
                console.log("Ctrl+C: Cancel");
            }
        };
        
        // Listen for shutdown menu input
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true); // Ensure raw mode
        }
        process.stdin.resume();
        process.stdin.on('data', shutdownMenuHandler);
    }

    private showShutdownTimerPrompt(minutes: number): void {
        // Clear the line and return to the beginning using ANSI codes
        process.stdout.write('\r\x1B[2K'); // \r: carriage return, \x1B[2K: clear entire line
        process.stdout.write(`Shutdown when? In \x1b[47m\x1b[30m${minutes}\x1b[0m minute${minutes === 1 ? '' : 's'}. (Enter confirm, ↑/↓ adjust, c cancel)`);
    }

    private cancelShutdownAndRestoreLogging(consoleTransport: any): void {
        // Cancel any active shutdown timer via ShutdownManager
        this.shutdownManager.clearShutdownTimer();
        
        console.log("\nOperation cancelled.");
        
        // Restore console logging
        if (consoleTransport) {
            systemLogger.add(consoleTransport);
            systemLogger.info('Console logging restored.');
        }
        
        // Clean up input handlers and restore main key listener
        process.stdin.removeAllListeners('data');
        this.setupKeyListener();
    }
}