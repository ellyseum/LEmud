import { ConnectedClient } from '../types';
import { ClientManager } from '../client/clientManager';
import { systemLogger } from '../utils/logger';
import { getPromptText } from '../utils/promptFormatter';
import { createAdminMessageBox } from '../utils/messageFormatter';
import { CommandHandler } from '../command/commandHandler';

export class UserMonitor {
    private clientManager: ClientManager;
    private onMonitoringEnd: () => void;
    private commandHandler: CommandHandler;

    constructor(
        clientManager: ClientManager, 
        onMonitoringEnd: () => void,
        commandHandler: CommandHandler
    ) {
        this.clientManager = clientManager;
        this.onMonitoringEnd = onMonitoringEnd;
        this.commandHandler = commandHandler;
    }

    public startMonitorUserSession(): void {
        // Clear any existing stdin listeners so monitor handlers take precedence
        process.stdin.removeAllListeners('data');
        
        // Pause console logging
        const winston = require('winston');
        let monitorConsoleTransport: any = null;
        const consoleTransport = systemLogger.transports.find((t: any) => t instanceof winston.transports.Console);
        if (consoleTransport) {
            monitorConsoleTransport = consoleTransport;
            systemLogger.remove(monitorConsoleTransport);
            console.log("\nConsole logging paused. Starting user monitoring...");
        }
        
        // Get authenticated users for monitoring
        const authenticatedUsers: string[] = [];
        this.clientManager.getClients().forEach((client => {
            if (client.authenticated && client.user) {
                authenticatedUsers.push(client.user.username);
            }
        }));
        
        if (authenticatedUsers.length === 0) {
            console.log("\n=== Monitor User ===");
            console.log("No authenticated users available to monitor.");
            
            // Restore console logging
            if (monitorConsoleTransport) {
                systemLogger.add(monitorConsoleTransport);
                systemLogger.info('Console logging restored.');
            }
            
            // Call the onMonitoringEnd callback
            this.onMonitoringEnd();
            return;
        }
        
        console.log("\n=== Monitor User ===");
        
        // Set up user selection menu
        let selectedIndex = 0;
        
        // Function to display the user selection menu
        const displayUserSelectionMenu = () => {
            console.clear();
            console.log("\n=== Monitor User ===");
            console.log("Select user to monitor (↑/↓ keys, Enter to select, Ctrl+C to cancel):");
            
            for (let i = 0; i < authenticatedUsers.length; i++) {
                const userDisplay = `${i + 1}. ${authenticatedUsers[i]}`;
                if (i === selectedIndex) {
                    process.stdout.write(`\x1b[47m\x1b[30m${userDisplay}\x1b[0m\n`);
                } else {
                    process.stdout.write(`${userDisplay}\n`);
                }
            }
        };
        
        // Display the initial menu
        displayUserSelectionMenu();
        
        // Handle user selection
        const userSelectionHandler = (selectionKey: string) => {
            // Handle Ctrl+C - cancel and return to main menu
            if (selectionKey === '\u0003') {
                console.log('\n\nUser monitoring cancelled.');
                process.stdin.removeListener('data', userSelectionHandler);
                
                // Restore console logging
                if (monitorConsoleTransport) {
                    systemLogger.add(monitorConsoleTransport);
                    systemLogger.info('Console logging restored.');
                }
                
                this.onMonitoringEnd();
                return;
            }
            
            // Handle arrow keys for selection
            if (selectionKey === '\u001b[A' || selectionKey === '\u001bOA') { // Up arrow
                selectedIndex = (selectedIndex > 0) ? selectedIndex - 1 : authenticatedUsers.length - 1;
                displayUserSelectionMenu();
            }
            else if (selectionKey === '\u001b[B' || selectionKey === '\u001bOB') { // Down arrow
                selectedIndex = (selectedIndex < authenticatedUsers.length - 1) ? selectedIndex + 1 : 0;
                displayUserSelectionMenu();
            }
            // Handle Enter - start monitoring selected user
            else if (selectionKey === '\r' || selectionKey === '\n') {
                const selectedUsername = authenticatedUsers[selectedIndex];
                console.log(`\n\nStarting monitoring session for user: ${selectedUsername}\n`);
                
                // Find the client object for the selected user
                let targetClient: ConnectedClient | undefined;
                
                this.clientManager.getClients().forEach((client) => {
                    if (client.authenticated && client.user && client.user.username === selectedUsername) {
                        targetClient = client;
                    }
                });
                
                if (!targetClient) {
                    console.log(`\nERROR: Could not find client for user ${selectedUsername}`);
                    process.stdin.removeListener('data', userSelectionHandler);
                    
                    // Restore console logging
                    if (monitorConsoleTransport) {
                        systemLogger.add(monitorConsoleTransport);
                        systemLogger.info('Console logging restored.');
                    }
                    
                    this.onMonitoringEnd();
                    return;
                }
                
                // Remove the user selection handler
                process.stdin.removeListener('data', userSelectionHandler);
                
                // Start the monitoring session
                this.startMonitoringSessionInternal(targetClient, selectedUsername, monitorConsoleTransport);
            }
        };
        
        // Listen for user selection input
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', userSelectionHandler);
    }

    private displayMonitoringMenu(): void {
        console.log('=== Monitoring Session Controls ===');
        console.log('a: Send admin command');
        console.log('s: Toggle stop user input');
        console.log('m: Send admin message');
        console.log('k: Kick user');
        console.log('u: Toggle sudo access');
        console.log('t: Take over session');
        console.log('h or ?: Show this help menu');
        console.log('c: Cancel monitoring');
        console.log('===============================\n');
    }

    private promptForInput(
        promptText: string,
        callback: (answer: string) => void,
        cancelCallback: () => void = () => {},
        options: { hideInput?: boolean } = {}
    ): void {
        // Ensure previous listeners are removed and raw mode is off initially
        process.stdin.removeAllListeners('data');
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false); // Turn off raw mode before writing prompt
        }

        process.stdout.write(promptText); // Display the prompt

        let buffer = '';
        let cursorPosition = 0; // Position within the buffer

        // Set raw mode and resume stdin for character-by-character input
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        process.stdin.resume();
        process.stdin.setEncoding('utf8');

        const inputHandler = (key: string) => {
            switch (key) {
                case '\u0003': // Ctrl+C
                    cleanup();
                    console.log("\nOperation cancelled.");
                    try {
                        cancelCallback();
                    } catch (error) {
                        console.error(`Error in cancel callback:`, error);
                    }
                    break;

                case '\r': // Enter key
                case '\n': // Enter key (sometimes)
                    cleanup();
                    process.stdout.write('\n'); // Move to the next line
                    try {
                        callback(buffer);
                    } catch (error) {
                        console.error(`Error in input callback:`, error);
                    }
                    break;

                case '\u007f': // Backspace (macOS/Linux)
                case '\b':     // Backspace (Windows might send this)
                    if (cursorPosition > 0) {
                        // Remove character from buffer
                        buffer = buffer.slice(0, cursorPosition - 1) + buffer.slice(cursorPosition);
                        cursorPosition--;

                        // Update display: move cursor left, write space, move cursor left again
                        process.stdout.write('\b \b');
                    }
                    break;

                default:
                    // Handle printable characters
                    if (key >= ' ' && key <= '~') { // Basic printable ASCII range
                        buffer = buffer.slice(0, cursorPosition) + key + buffer.slice(cursorPosition);
                        cursorPosition++;
                        process.stdout.write(options.hideInput ? '*' : key);
                    }
                    break;
            }
        };

        const cleanup = () => {
            process.stdin.removeListener('data', inputHandler);
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false); // Turn off raw mode
            }
        };

        process.stdin.on('data', inputHandler);
    }

    private startMonitoringSessionInternal(
        targetClient: ConnectedClient, 
        username: string, 
        monitorConsoleTransport: any
    ): void {
        let userSudoEnabled = false; // Track if sudo access is enabled
        
        this.displayMonitoringMenu(); // Display the menu initially
        
        // Flag the client as being monitored
        targetClient.isBeingMonitored = true;
        
        // Create a hook to intercept and display client output for the admin
        if (!(targetClient.connection as any).originalWrite) {
            (targetClient.connection as any).originalWrite = targetClient.connection.write;
        }
        const originalWrite = (targetClient.connection as any).originalWrite;

        targetClient.connection.write = (data: any, encoding?: BufferEncoding | undefined, cb?: ((err?: Error | undefined) => void) | undefined): boolean => {
            // Call the original write function using apply to maintain context
            const result = originalWrite.apply(targetClient.connection, [data, encoding, cb]);
            
            // Also write to the console
            process.stdout.write(data);
            
            // Return the original result
            return result;
        };

        // Function to close the monitoring session
        const closeMonitoring = () => {
            console.log('\nMonitoring session ended.');
            
            // Remove all listeners FIRST
            process.stdin.removeAllListeners('data');
            
            // Restore the original write function 
            if ((targetClient.connection as any).originalWrite) {
                targetClient.connection.write = (targetClient.connection as any).originalWrite;
                delete (targetClient.connection as any).originalWrite;
            }

            // Remove monitoring status
            targetClient.isBeingMonitored = false;
            
            // Ensure user input is re-enabled
            if (targetClient.isInputBlocked) {
                targetClient.isInputBlocked = false;
                targetClient.connection.write('\r\n\x1b[33mYour input ability has been restored.\x1b[0m\r\n');
                
                // Redisplay the prompt for the user
                const promptText = getPromptText(targetClient);
                targetClient.connection.write(promptText);
                if (targetClient.buffer.length > 0) {
                    targetClient.connection.write(targetClient.buffer);
                }
            }
            
            // Remove sudo access if it was granted
            if (userSudoEnabled && targetClient.user) {
                const { SudoCommand } = require('../command/commands/sudo.command');
                (SudoCommand as any).activeAdmins.delete(targetClient.user.username.toLowerCase());
                systemLogger.info(`Removed temporary sudo access from user: ${username}`);
            }
            
            // Restore console logging
            if (monitorConsoleTransport) {
                systemLogger.add(monitorConsoleTransport);
                systemLogger.info('Console logging restored. Monitoring session ended.');
            }
            
            // Call the onMonitoringEnd callback
            this.onMonitoringEnd();
        };
        
        // This is our main monitor key handler
        const setupMonitorKeyHandler = () => {
            // Clear any existing stdin listeners to avoid stacking handlers
            process.stdin.removeAllListeners('data');
            
            // Reset stdin state
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
            }
            process.stdin.resume();
            process.stdin.setEncoding('utf8');
            
            // Define the handler function
            const monitorKeyHandler = (key: string) => {
                // Handle Ctrl+C or 'c' to cancel monitoring
                if (key === '\u0003' || key.toLowerCase() === 'c') {
                    closeMonitoring();
                    return;
                }

                // Handle 'h' or '?' to show help
                if (key.toLowerCase() === 'h' || key === '?') {
                    this.displayMonitoringMenu();
                    return;
                }
                
                // Handle 's' to toggle blocking user input
                if (key.toLowerCase() === 's') {
                    // Toggle the input blocking state
                    targetClient.isInputBlocked = !targetClient.isInputBlocked;
                    
                    // Notify admin of the change
                    console.log(`\nUser input ${targetClient.isInputBlocked ? 'disabled' : 'enabled'}.`);
                    
                    // Notify the user
                    if (targetClient.isInputBlocked) {
                        targetClient.connection.write('\r\n\x1b[33mAn admin has temporarily disabled your input ability.\x1b[0m\r\n');
                    } else {
                        targetClient.connection.write('\r\n\x1b[33mAn admin has re-enabled your input ability.\x1b[0m\r\n');
                    }
                    
                    // Re-display the prompt for the user
                    const promptText = getPromptText(targetClient);
                    targetClient.connection.write(promptText);
                    if (targetClient.buffer.length > 0) {
                        targetClient.connection.write(targetClient.buffer);
                    }
                    return;
                }
                
                // Handle 'a' to send admin command
                if (key.toLowerCase() === 'a') {
                    console.log("\n=== Admin Command ===");
                    this.promptForInput(
                        "Enter command to execute as user (Ctrl+C to cancel): > ",
                        (command) => {
                            if (command.trim()) {
                                console.log(`Executing command: ${command}`);
                                
                                // If the user is currently typing something, clear their input first
                                if (targetClient.buffer.length > 0) {
                                    // Get the current prompt length
                                    const promptText = getPromptText(targetClient);
                                    const promptLength = promptText.length;
                                    
                                    // Clear the entire line and return to beginning
                                    targetClient.connection.write('\r' + ' '.repeat(promptLength + targetClient.buffer.length) + '\r');
                                    
                                    // Redisplay the prompt (since we cleared it as well)
                                    targetClient.connection.write(promptText);
                                    
                                    // Clear the buffer
                                    targetClient.buffer = '';
                                }
                                
                                // Notify user of admin command
                                targetClient.connection.write(`\r\n\x1b[33mAdmin executed: ${command}\x1b[0m\r\n`);
                                
                                // Use the handleCommand method
                                this.commandHandler.handleCommand(targetClient, command);
                            } else {
                                console.log('Command was empty, not executing.');
                            }
                            // Re-setup the main handler after command
                            setupMonitorKeyHandler(); 
                        },
                        () => setupMonitorKeyHandler() // Cancel callback: Re-setup the main handler
                    );
                    return;
                }
                
                // Handle 'm' to send admin message
                if (key.toLowerCase() === 'm') {
                    console.log("\n=== Admin Message ===");
                    this.promptForInput(
                        "Enter message to send to user (Ctrl+C to cancel): > ",
                        (message) => {
                            if (message.trim()) {
                                console.log(`Sending message to user: ${message}`);
                                
                                // Create a boxed message
                                const boxedMessage = createAdminMessageBox(message);
                                
                                // Send the message to the user
                                targetClient.connection.write(boxedMessage);
                                
                                // Re-display the prompt
                                const promptText = getPromptText(targetClient);
                                targetClient.connection.write(promptText);
                                if (targetClient.buffer.length > 0) {
                                    targetClient.connection.write(targetClient.buffer);
                                }
                                
                                // Log the admin message
                                systemLogger.info(`Admin sent message to user ${username}: ${message}`);
                            } else {
                                console.log('Message was empty, not sending.');
                            }
                            // Re-setup the main handler after message
                            setupMonitorKeyHandler(); 
                        },
                        () => setupMonitorKeyHandler() // Cancel callback: Re-setup the main handler
                    );
                    return;
                }
                
                // Handle 'k' to kick the user
                if (key.toLowerCase() === 'k') {
                    console.log("\n=== Kick User ===");
                    this.promptForInput(
                        `Are you sure you want to kick ${username}? (y/n) > `,
                        (answer) => {
                            if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
                                console.log(`Kicking user: ${username}`);
                                
                                // Notify the user they're being kicked
                                targetClient.connection.write('\r\n\x1b[31mYou are being disconnected by an administrator.\x1b[0m\r\n');
                                
                                // Log the kick
                                systemLogger.info(`Admin kicked user: ${username}`);
                                
                                // Disconnect the user (with slight delay to ensure they see the message)
                                setTimeout(() => {
                                    targetClient.connection.end();
                                    closeMonitoring();
                                }, 1000);
                                
                                return;
                            } else {
                                console.log('Kick cancelled.');
                                // Re-setup the main handler after kick confirmation
                                setupMonitorKeyHandler(); 
                            }
                        },
                        () => setupMonitorKeyHandler() // Cancel callback: Re-setup the main handler
                    );
                    return;
                }
                
                // Handle 'u' to toggle sudo access
                if (key.toLowerCase() === 'u') {
                    if (!targetClient.user) {
                        console.log('\nCannot grant sudo access: user not authenticated.');
                        return;
                    }
                    
                    // Toggle sudo access
                    userSudoEnabled = !userSudoEnabled;
                    
                    if (userSudoEnabled) {
                        // Grant temporary sudo access using SudoCommand system
                        const { SudoCommand } = require('../command/commands/sudo.command');
                        (SudoCommand as any).activeAdmins.add(targetClient.user.username.toLowerCase());
                        console.log(`\nGranted temporary sudo access to ${username}.`);
                        targetClient.connection.write('\r\n\x1b[33mAn admin has granted you temporary sudo access.\x1b[0m\r\n');
                        
                        // Log the action
                        systemLogger.info(`Admin granted temporary sudo access to user: ${username}`);
                    } else {
                        // Remove sudo access using SudoCommand system
                        const { SudoCommand } = require('../command/commands/sudo.command');
                        (SudoCommand as any).activeAdmins.delete(targetClient.user.username.toLowerCase());
                        console.log(`\nRemoved sudo access from ${username}.`);
                        targetClient.connection.write('\r\n\x1b[33mYour temporary sudo access has been revoked.\x1b[0m\r\n');
                        
                        // Log the action
                        systemLogger.info(`Admin removed sudo access from user: ${username}`);
                    }
                    
                    // Re-display the prompt for the user
                    const promptText = getPromptText(targetClient);
                    targetClient.connection.write(promptText);
                    if (targetClient.buffer.length > 0) {
                        targetClient.connection.write(targetClient.buffer);
                    }
                    
                    return;
                }
                
                // Handle 't' to enter takeover mode
                if (key.toLowerCase() === 't') {
                    process.stdin.removeAllListeners('data');
                    console.log('\n=== Takeover Mode: typing will be sent to user (Ctrl+C to exit) ===');
                    
                    // Use a dedicated function to reset stdin
                    const setupTakeoverHandler = () => {
                        if (process.stdin.isTTY) {
                            process.stdin.setRawMode(true);
                        }
                        process.stdin.resume();
                        process.stdin.setEncoding('utf8');
                        
                        process.stdin.on('data', (tk: string) => {
                            // Exit takeover on Ctrl+C
                            if (tk === '\u0003') {
                                console.log('\nExiting takeover mode.');
                                process.stdin.removeAllListeners('data');
                                setupMonitorKeyHandler(); // Return to main monitor mode
                                return;
                            }
                            
                            // Get client manager instance to use its handleClientData method
                            const clientManager = require('../client/clientManager').ClientManager.getInstance();
                            
                            // Save original isInputBlocked state
                            const originalBlockedState = targetClient.isInputBlocked;
                            
                            // Temporarily allow input even if user input is blocked
                            targetClient.isInputBlocked = false;
                            
                            // Process input through client manager's input handling system
                            clientManager.handleClientData(targetClient, tk);
                            
                            // Restore original block state
                            targetClient.isInputBlocked = originalBlockedState;
                        });
                    };
                    
                    setupTakeoverHandler();
                    return;
                }
            };
            
            // Set up the monitor key handler
            process.stdin.on('data', monitorKeyHandler);
        };
        
        // Initial setup of the key handler
        setupMonitorKeyHandler();
        
        // Log the monitoring session
        systemLogger.info(`Console admin started monitoring user: ${username}`);
    }
}