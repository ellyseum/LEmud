import { ConnectedClient } from '../types';
import { ClientManager } from '../client/clientManager';
import { systemLogger } from '../utils/logger';
import { getPromptText } from '../utils/promptFormatter';
import { createAdminMessageBox } from '../utils/messageFormatter';
import { GameServer } from '../app';
import { CommandHandler } from '../command/commandHandler';
import readline from 'readline';

export class UserMonitor {
    private clientManager: ClientManager;
    private onMonitoringEnd: () => void;
    private gameServer: GameServer;
    private commandHandler: CommandHandler;

    constructor(
        clientManager: ClientManager, 
        gameServer: GameServer, 
        onMonitoringEnd: () => void,
        commandHandler: CommandHandler
    ) {
        this.clientManager = clientManager;
        this.gameServer = gameServer;
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
        process.stdin.on('data', userSelectionHandler);
    }

    private startMonitoringSessionInternal(
        targetClient: ConnectedClient, 
        username: string, 
        monitorConsoleTransport: any
    ): void {
        // Clear any existing stdin listeners to avoid ESC leaks
        process.stdin.removeAllListeners('data');
        let userSudoEnabled = false; // Track if sudo access is enabled
        
        console.log('=== Monitoring Session Controls ===');
        console.log('a: Send admin command');
        console.log('s: Toggle stop user input');
        console.log('m: Send admin message');
        console.log('k: Kick user');
        console.log('u: Toggle sudo access');
        console.log('t: Take over session');
        console.log('c: Cancel monitoring');
        console.log('===============================\n');
        
        // Flag the client as being monitored
        targetClient.isBeingMonitored = true;
        
        // Function to close the monitoring session
        const closeMonitoring = () => {
            // Restore the original write function FIRST
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
                // Use the static activeAdmins Set directly
                const { SudoCommand } = require('../command/commands/sudo.command');
                (SudoCommand as any).activeAdmins.delete(targetClient.user.username.toLowerCase());
                systemLogger.info(`Removed temporary sudo access from user: ${username}`);
            }
            
            // Clean up console and event listeners
            console.log('\nMonitoring session ended.');
            process.stdin.removeAllListeners('data');
            
            // Restore console logging
            if (monitorConsoleTransport) {
                systemLogger.add(monitorConsoleTransport);
                systemLogger.info('Console logging restored. Monitoring session ended.');
            }
            
            // Call the onMonitoringEnd callback
            this.onMonitoringEnd();
        };
        
        // Create a hook to intercept and display client output for the admin
        // Store original write if it hasn't been stored already
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
        
        // Set up handler for monitoring session keys
        const monitorKeyHandler = (key: string) => {
            // Handle Ctrl+C or 'c' to cancel monitoring
            if (key === '\u0003' || key.toLowerCase() === 'c') {
                closeMonitoring();
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
                // Temporarily remove the key handler to allow command input
                process.stdin.removeListener('data', monitorKeyHandler);
                
                // Set input mode to line input
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(false);
                }
                
                // Create readline interface for command input
                console.log('\n=== Admin Command ===');
                console.log('Enter command to execute as user (Ctrl+C to cancel):');
                
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                
                // Get the command
                rl.question('> ', (command) => {
                    rl.close();
                    
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
                        
                        // Use the handleCommand method instead of trying to use processCommand
                        this.commandHandler.handleCommand(targetClient, command);
                    } else {
                        console.log('Command was empty, not executing.');
                    }
                    
                    // Restore raw mode and the key handler
                    if (process.stdin.isTTY) {
                        process.stdin.setRawMode(true);
                    }
                    process.stdin.resume();
                    process.stdin.on('data', monitorKeyHandler);
                });
                
                return;
            }
            
            // Handle 'm' to send admin message
            if (key.toLowerCase() === 'm') {
                // Temporarily remove the key handler to allow message input
                process.stdin.removeListener('data', monitorKeyHandler);
                
                // Set input mode to line input
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(false);
                }
                
                // Create readline interface for message input
                console.log('\n=== Admin Message ===');
                console.log('Enter message to send to user (Ctrl+C to cancel):');
                
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                
                // Get the message
                rl.question('> ', (message) => {
                    rl.close();
                    
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
                    
                    // Restore raw mode and the key handler
                    if (process.stdin.isTTY) {
                        process.stdin.setRawMode(true);
                    }
                    process.stdin.resume();
                    process.stdin.on('data', monitorKeyHandler);
                });
                
                return;
            }
            
            // Handle 'k' to kick the user
            if (key.toLowerCase() === 'k') {
                // Ask for confirmation
                // Temporarily remove the key handler to allow confirmation input
                process.stdin.removeListener('data', monitorKeyHandler);
                
                // Set input mode to line input
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(false);
                }
                
                // Create readline interface for confirmation
                console.log(`\n=== Kick User ===`);
                console.log(`Are you sure you want to kick ${username}? (y/n)`);
                
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                
                // Get confirmation
                rl.question('> ', (answer) => {
                    rl.close();
                    
                    if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
                        console.log(`Kicking user: ${username}`);
                        
                        // Notify the user they're being kicked
                        targetClient.connection.write('\r\n\x1b[31mYou are being disconnected by an administrator.\x1b[0m\r\n');
                        
                        // Log the kick
                        systemLogger.info(`Admin kicked user: ${username}`);
                        
                        // Disconnect the user (with slight delay to ensure they see the message)
                        setTimeout(() => {
                            targetClient.connection.end();
                        }, 1000);
                        
                        // Close the monitoring session (will restore original write)
                        closeMonitoring();
                        return; // Exit after kicking
                    } else {
                        console.log('Kick cancelled.');
                        
                        // Restore raw mode and the key handler
                        if (process.stdin.isTTY) {
                            process.stdin.setRawMode(true);
                        }
                        process.stdin.resume();
                        process.stdin.on('data', monitorKeyHandler);
                    }
                });
                
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
                process.stdin.removeListener('data', monitorKeyHandler);
                console.log('\n=== Takeover Mode: typing will be sent to user (Ctrl+C to exit) ===');
                const takeoverKeyHandler = (tk: string) => {
                    // Exit takeover on Ctrl+C
                    if (tk === '\u0003') {
                        process.stdin.removeListener('data', takeoverKeyHandler);
                        if (process.stdin.isTTY) process.stdin.setRawMode(true);
                        process.stdin.on('data', monitorKeyHandler);
                        console.log('\nExiting takeover mode.');
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
                };
                process.stdin.on('data', takeoverKeyHandler);
                return;
            }
        };
        
        // Start listening for admin key presses
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', monitorKeyHandler);
        
        // Log the monitoring session
        systemLogger.info(`Console admin started monitoring user: ${username}`);
    }
}