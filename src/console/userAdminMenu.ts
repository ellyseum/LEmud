import readline from 'readline';
import { UserManager } from '../user/userManager';
import { ClientManager } from '../client/clientManager';
import { ConnectedClient } from '../types';
import { systemLogger } from '../utils/logger';
import { LocalSessionManager } from './localSessionManager';
import { TelnetServer } from '../server/telnetServer';
import { CommandHandler } from '../command/commandHandler';
import { getPromptText } from '../utils/promptFormatter';
import { createAdminMessageBox } from '../utils/messageFormatter';
import { GameServer } from '../app';
import config from '../config';

// Define the structure for menu state
interface MenuState {
  active: boolean;
  currentMenu: string; // 'main', 'edit', 'flags', etc.
  selectedUser: string;
  selectedIndex: number;
  currentPage: number;
  allUsers: any[];
}

export class UserAdminMenu {
    private userManager: UserManager;
    private clientManager: ClientManager;
    private commandHandler: CommandHandler;
    private localSessionManager: LocalSessionManager;
    private telnetServer: TelnetServer;
    private gameServer: GameServer;
    private onMenuExit: () => void;

    private menuState: MenuState = {
        active: false,
        currentMenu: 'main',
        selectedUser: '',
        selectedIndex: 0,
        currentPage: 0,
        allUsers: []
    };

    // Store console transport to restore later
    private _userAdminConsoleTransport: any = null;

    constructor(
        userManager: UserManager,
        clientManager: ClientManager,
        commandHandler: CommandHandler,
        localSessionManager: LocalSessionManager,
        telnetServer: TelnetServer,
        gameServer: GameServer,
        onMenuExit: () => void
    ) {
        this.userManager = userManager;
        this.clientManager = clientManager;
        this.commandHandler = commandHandler;
        this.localSessionManager = localSessionManager;
        this.telnetServer = telnetServer;
        this.gameServer = gameServer;
        this.onMenuExit = onMenuExit;
    }

    public startUserAdminMenu(): void {
        // Make sure we're not already handling user admin menu
        process.stdin.removeAllListeners('data');
        
        // Reset the menu state
        this.menuState = {
            active: true,
            currentMenu: 'main',
            selectedUser: '',
            selectedIndex: 0,
            currentPage: 0,
            allUsers: []
        };
        
        // Pause console logging - store the console transport to restore later
        const winston = require('winston');
        
        // Collect ALL console transports to ensure complete pausing of output
        const userAdminConsoleTransports = systemLogger.transports.filter((t: any) => 
            t instanceof winston.transports.Console
        );
        
        if (userAdminConsoleTransports.length > 0) {
            // Store all transports to restore later
            this._userAdminConsoleTransport = userAdminConsoleTransports;
            
            // Remove all console transports to completely suppress logging
            userAdminConsoleTransports.forEach(transport => {
                systemLogger.remove(transport);
            });
            
            console.log("\nConsole logging paused while user admin menu is active...");
        } else {
            console.log("\nCould not find console transport to pause logging.");
        }
        
        // Get all registered users and sort alphabetically
        const allUsers = this.userManager.getAllUsers().sort((a, b) => 
            a.username.toLowerCase().localeCompare(b.username.toLowerCase())
        );
        
        // Store in the state
        this.menuState.allUsers = allUsers;
        
        if (allUsers.length === 0) {
            console.log("\n=== User Admin Menu ===");
            console.log("No registered users found.");
            console.log("=====================\n");
            
            // Restore console logging before returning
            if (this._userAdminConsoleTransport) {
                systemLogger.add(this._userAdminConsoleTransport);
                systemLogger.info('Console logging restored after user admin menu.');
            }
            
            // Call onMenuExit
            this.exitUserAdminMenu();
            return;
        }

        // Display the initial menu
        this.displayUserListMenu();
        
        // Set up key handler for the menu
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        
        // Add our non-recursive menu handler
        process.stdin.on('data', this.handleMenuKeyPress.bind(this));
    }
    
    private exitUserAdminMenu(): void {
        console.log('\n\nUser admin menu canceled.');
        
        // Restore console logging
        const winston = require('winston');
        
        // Handle both single transport and array of transports
        if (this._userAdminConsoleTransport) {
            if (Array.isArray(this._userAdminConsoleTransport)) {
                // Restore all transports that were removed
                this._userAdminConsoleTransport.forEach(transport => {
                    if (!systemLogger.transports.some((t: any) => t === transport)) {
                        systemLogger.add(transport);
                    }
                });
            } else if (!systemLogger.transports.some((t: any) => t === this._userAdminConsoleTransport)) {
                // For backward compatibility
                systemLogger.add(this._userAdminConsoleTransport);
            }
            
            systemLogger.info('Console logging restored after user admin menu.');
            this._userAdminConsoleTransport = null;
        }
        
        // Reset menu state
        this.menuState.active = false;
        
        // Clean up all listeners
        process.stdin.removeAllListeners('data');
        
        // Call the callback for menu exit
        this.onMenuExit();
    }
    
    private handleMenuKeyPress(key: string): void {
        // Handle Ctrl+C - cancel and return to main menu from any submenu
        if (key === '\u0003') {
            this.exitUserAdminMenu();
            return;
        }
        
        // Route to appropriate handler based on current menu state
        switch (this.menuState.currentMenu) {
            case 'main':
                this.handleMainMenuKeyPress(key);
                break;
            case 'edit':
                this.handleEditMenuKeyPress(key);
                break;
            case 'flags':
                this.handleFlagsMenuKeyPress(key);
                break;
            // Add other menu states as needed
            default:
                // Default to main menu
                this.menuState.currentMenu = 'main';
                this.displayUserListMenu();
        }
    }
    
    private handleMainMenuKeyPress(key: string): void {
        const { selectedIndex, currentPage, allUsers } = this.menuState;
        const usersPerPage = 10; // Configurable?
        const totalPages = Math.ceil(allUsers.length / usersPerPage);
        
        // Handle arrow keys for navigation
        if (key === '\u001b[A' || key === '\u001bOA') { // Up arrow
            if (selectedIndex > 0) {
                this.menuState.selectedIndex--;
                // Check if page needs to change
                if (this.menuState.selectedIndex < currentPage * usersPerPage) {
                    this.menuState.currentPage--;
                }
                this.displayUserListMenu();
            } else { // Wrap around to bottom
                this.menuState.selectedIndex = allUsers.length - 1;
                this.menuState.currentPage = totalPages - 1;
                this.displayUserListMenu();
            }
        }
        else if (key === '\u001b[B' || key === '\u001bOB') { // Down arrow
            if (selectedIndex < allUsers.length - 1) {
                this.menuState.selectedIndex++;
                // Check if page needs to change
                if (this.menuState.selectedIndex >= (currentPage + 1) * usersPerPage) {
                    this.menuState.currentPage++;
                }
                this.displayUserListMenu();
            } else { // Wrap around to top
                this.menuState.selectedIndex = 0;
                this.menuState.currentPage = 0;
                this.displayUserListMenu();
            }
        }
        else if (key === '\u001b[D' || key === '\u001bOD') { // Left arrow (Previous Page)
            if (currentPage > 0) {
                this.menuState.currentPage--;
                // Adjust selectedIndex to be the first item on the new page
                this.menuState.selectedIndex = this.menuState.currentPage * usersPerPage;
                this.displayUserListMenu();
            }
        }
        else if (key === '\u001b[C' || key === '\u001bOC') { // Right arrow (Next Page)
            if (currentPage < totalPages - 1) {
                this.menuState.currentPage++;
                // Adjust selectedIndex to be the first item on the new page
                this.menuState.selectedIndex = this.menuState.currentPage * usersPerPage;
                this.displayUserListMenu();
            }
        }
        
        // Handle action keys
        else if (key.toLowerCase() === 'd') {
            // Direct login as selected user
            const selectedUser = allUsers[selectedIndex];
            if (selectedUser) {
                this.menuState.selectedUser = selectedUser.username;
                this.handleDirectLogin(selectedUser.username);
            }
        }
        else if (key.toLowerCase() === 'k') {
            // Kick selected user
            const selectedUser = allUsers[selectedIndex];
            if (selectedUser) {
                this.menuState.selectedUser = selectedUser.username;
                this.handleKickUser(selectedUser.username);
            }
        }
        else if (key.toLowerCase() === 'm') {
            // Send admin message to selected user
            const selectedUser = allUsers[selectedIndex];
            if (selectedUser) {
                this.menuState.selectedUser = selectedUser.username;
                this.handleSendAdminMessage(selectedUser.username);
            }
        }
        else if (key.toLowerCase() === 'e') {
            // Edit selected user
            const selectedUser = allUsers[selectedIndex];
            if (selectedUser) {
                this.menuState.selectedUser = selectedUser.username;
                this.menuState.currentMenu = 'edit';
                this.displayEditUserMenu(selectedUser.username);
            }
        }
        else if (key.toLowerCase() === 'p') {
            // Change password for selected user
            const selectedUser = allUsers[selectedIndex];
            if (selectedUser) {
                this.menuState.selectedUser = selectedUser.username;
                this.handleChangePassword(selectedUser.username);
            }
        }
        else if (key.toLowerCase() === 't') {
            // Delete selected user
            const selectedUser = allUsers[selectedIndex];
            if (selectedUser) {
                this.menuState.selectedUser = selectedUser.username;
                this.handleDeleteUser(selectedUser.username);
            }
        }
        else if (key.toLowerCase() === 'c') {
            // Cancel and return to main menu
            this.exitUserAdminMenu();
        }
    }
    
    private handleEditMenuKeyPress(key: string): void {
        // Handle numeric inputs for the edit menu
        if (key === '1') {
            // Flag editing
            this.menuState.currentMenu = 'flags';
            this.displayEditUserFlagsMenu(this.menuState.selectedUser);
        }
        else if (key === '2') {
            // Toggle admin status
            this.handleToggleAdminStatus(this.menuState.selectedUser);
        }
        else if (key === '3') {
            // Reset stats
            this.handleResetUserStats(this.menuState.selectedUser);
        }
        else if (key === '4' || key.toLowerCase() === 'c' || key === '\u001b') { // 4, c, or ESC
            // Return to main menu
            this.menuState.currentMenu = 'main';
            this.displayUserListMenu();
        }
    }
    
    private handleFlagsMenuKeyPress(key: string): void {
        // Handle numeric inputs for the flags menu
        if (key === '1') {
            // Add flag - switch to text input mode
            this.promptForFlagAdd(this.menuState.selectedUser);
        }
        else if (key === '2') {
            // Remove flag - switch to flag selection mode
            this.promptForFlagRemoval(this.menuState.selectedUser);
        }
        else if (key === '3' || key.toLowerCase() === 'c' || key === '\u001b') { // 3, c, or ESC
            // Return to edit menu
            this.menuState.currentMenu = 'edit';
            this.displayEditUserMenu(this.menuState.selectedUser);
        }
    }
    
    private displayUserListMenu(): void {
        const { selectedIndex, currentPage, allUsers } = this.menuState;
        const usersPerPage = 10; // Configurable?
        const totalPages = Math.ceil(allUsers.length / usersPerPage);
        
        // Clear the screen
        console.clear();
        
        // Calculate page bounds
        const startIdx = currentPage * usersPerPage;
        const endIdx = Math.min(startIdx + usersPerPage, allUsers.length);
        const pageUsers = allUsers.slice(startIdx, endIdx);
        
        // Display header
        console.log(`\n=== User Admin Menu (Page ${currentPage + 1}/${totalPages}) ===`);
        console.log("Navigate: ↑/↓ keys | Actions: (d)irect login, (k)ick, (m)essage, (e)dit, change (p)assword, dele(t)e, (c)ancel");
        console.log("Page navigation: ←/→ keys | Selected user highlighted in white");
        console.log("");
        
        // Display users with the selected one highlighted
        for (let i = 0; i < pageUsers.length; i++) {
            const user = pageUsers[i];
            const userIndexOnPage = i; // Index relative to the current page
            const absoluteUserIndex = startIdx + userIndexOnPage; // Absolute index in allUsers
            const isSelected = absoluteUserIndex === selectedIndex;
            
            // Format each user entry with additional info
            const isOnline = this.userManager.isUserActive(user.username);
            const lastLoginDate = user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never';
            
            let userDisplay = `${absoluteUserIndex + 1}. ${user.username} `;
            if (isOnline) userDisplay += '\x1b[32m[ONLINE]\x1b[0m '; // Green for online
            else userDisplay += '\x1b[90m[OFFLINE]\x1b[0m '; // Grey for offline
            userDisplay += `(Last login: ${lastLoginDate})`;
            
            if (isSelected) {
                console.log(`\x1b[47m\x1b[30m${userDisplay}\x1b[0m`); // White background, black text
            } else {
                console.log(userDisplay);
            }
        }
        
        console.log("\nPress letter key for action or (c)ancel / Ctrl+C");
    }

    private handleDirectLogin(username: string): void {
        console.log(`\nInitiating direct login as ${username}...`);
        
        // Check if user exists
        const user = this.userManager.getUser(username);
        if (!user) {
            console.log(`\nError: User ${username} not found.`);
            setTimeout(() => {
                // Redisplay the menu after error
                this.menuState.currentMenu = 'main';
                this.displayUserListMenu();
                // Re-attach listener
                process.stdin.removeAllListeners('data');
                process.stdin.on('data', this.handleMenuKeyPress.bind(this));
                if (process.stdin.isTTY) process.stdin.setRawMode(true);
            }, 2000);
            return;
        }
        
        // Remove menu key handler before potentially switching modes
        process.stdin.removeAllListeners('data');

        // First check if user is already logged in
        if (this.userManager.isUserActive(username)) {
            // Ask if we want to take over the session
            console.log(`\nUser ${username} is already logged in. Do you want to take over their session? (y/n)`);
            
            // Temporarily switch to line input mode
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false);
            }
            
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            rl.on('SIGINT', () => {
                rl.close();
                console.log("\nLogin cancelled.");
                this.returnToUserAdminMenu();
            });
            
            rl.question('> ', (answer) => {
                rl.close();
                
                if (answer.toLowerCase() === 'y') {
                    // Find the client and take over
                    const clients = Array.from(this.clientManager.getClients().values());
                    const targetClient = clients.find(c => c.user && c.user.username === username);
                    
                    if (targetClient) {
                        // Notify the user they're being taken over
                        targetClient.connection.write('\r\n\x1b[33mAn administrator is taking over your session.\x1b[0m\r\n');
                        
                        // Before we start the forced session, ensure the local session is prepared
                        if (this.localSessionManager.prepareLocalSessionStart()) {
                            // Start forced session
                            this.localSessionManager.startForcedSession(this.telnetServer.getActualPort(), username)
                                .catch(error => {
                                    console.log(`\nError during forced login: ${error.message}`);
                                    this.returnToUserAdminMenu(2000); // Return after delay
                                });
                        } else {
                            console.log(`\nCannot prepare local session. Try again later.`);
                            this.returnToUserAdminMenu(2000);
                        }
                    } else {
                        console.log(`\nError: Could not find active session for ${username}.`);
                        this.returnToUserAdminMenu(2000); // Return after delay
                    }
                } else {
                    // Return to the menu
                    console.log(`\nLogin canceled.`);
                    this.returnToUserAdminMenu(1000); // Return after delay
                }
            });
        } else {
            // User is not logged in, so create a new console login with the forced session
            // Before we start the forced session, ensure the local session is prepared
            if (this.localSessionManager.prepareLocalSessionStart()) {
                this.localSessionManager.startForcedSession(this.telnetServer.getActualPort(), username)
                    .catch(error => {
                        console.log(`\nError during forced login: ${error.message}`);
                        this.returnToUserAdminMenu(2000); // Return after delay
                    });
            } else {
                console.log(`\nCannot prepare local session. Try again later.`);
                this.returnToUserAdminMenu(2000);
            }
        }
    }

    private handleKickUser(username: string): void {
        // Check if user is online first
        if (!this.userManager.isUserActive(username)) {
            console.log(`\nUser ${username} is not currently online.`);
            this.returnToUserAdminMenu(2000); // Return after delay
            return;
        }
        
        console.log(`\nKicking user ${username}. Are you sure? (y/n)`);
        
        // Temporarily change key handler for this question
        process.stdin.removeAllListeners('data');
        if (process.stdin.isTTY) process.stdin.setRawMode(true); // Need raw for y/n

        const confirmHandler = (key: string) => {
            process.stdin.removeListener('data', confirmHandler); // Remove self immediately

            if (key.toLowerCase() === 'y') {
                // Find the client and disconnect them
                const clients = Array.from(this.clientManager.getClients().values());
                const targetClient = clients.find(c => c.user && c.user.username === username);
                
                if (targetClient) {
                    // Notify the user they're being kicked
                    targetClient.connection.write('\r\n\x1b[31mYou have been disconnected by an administrator.\x1b[0m\r\n');
                    
                    // Log the action
                    systemLogger.info(`Admin kicked user: ${username}`);
                    
                    // Wait a moment then disconnect
                    setTimeout(() => {
                        targetClient.connection.end();
                        console.log(`\nUser ${username} has been kicked.`);
                        this.returnToUserAdminMenu(1000); // Return after delay
                    }, 500);
                } else {
                    console.log(`\nError: Could not find active session for ${username}.`);
                    this.returnToUserAdminMenu(2000); // Return after delay
                }
            } else {
                // Return to the menu
                console.log(`\nKick canceled.`);
                this.returnToUserAdminMenu(1000); // Return after delay
            }
        };
        
        // Set up the confirmation handler
        process.stdin.on('data', confirmHandler);
    }

    private handleSendAdminMessage(username: string): void {
        // Check if user exists
        const user = this.userManager.getUser(username);
        if (!user) {
            console.log(`\nError: User ${username} not found.`);
            this.returnToUserAdminMenu(2000);
            return;
        }
        
        // Create readline interface for message input
        process.stdin.removeAllListeners('data');
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
        
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        console.log(`\nEnter admin message to send to ${username} (Ctrl+C to cancel):`);

        rl.on('SIGINT', () => {
            rl.close();
            console.log("\nAdmin message cancelled.");
            this.returnToUserAdminMenu();
        });

        rl.question('> ', (message) => {
            rl.close();
            
            if (message.trim()) {
                // Log the message
                systemLogger.info(`Admin sent message to ${username}: ${message}`);
                
                // If user is online, send the message immediately
                if (this.userManager.isUserActive(username)) {
                    const targetClient = this.userManager.getActiveUserSession(username);
                    if (targetClient) {
                        // Use the boxed message formatter
                        const boxedMessage = createAdminMessageBox(message);
                        targetClient.connection.write(boxedMessage);
                        // Re-display prompt for user
                        const promptText = getPromptText(targetClient);
                        targetClient.connection.write(promptText);
                        if (targetClient.buffer.length > 0) {
                            targetClient.connection.write(targetClient.buffer);
                        }
                        console.log(`\nMessage sent to online user ${username}.`);
                    }
                }
                
                // Also store the message to be shown on next login if user is offline
                try {
                    if (!user.pendingAdminMessages) {
                        user.pendingAdminMessages = [];
                    }
                    user.pendingAdminMessages.push({
                        message,
                        timestamp: new Date().toISOString()
                    });
                    this.userManager.updateUser(username, user);
                    console.log(`\nMessage stored for ${username} (will be shown on next login).`);
                } catch (error) {
                    console.log(`\nError storing message: ${error}`);
                }
            } else {
                console.log(`\nEmpty message, not sending.`);
            }
            
            // Return to the menu
            this.returnToUserAdminMenu(1000);
        });
    }

    private displayEditUserMenu(username: string): void {
        // Get user data
        const user = this.userManager.getUser(username);
        if (!user) {
            console.log(`\nError: User ${username} not found.`);
            this.menuState.currentMenu = 'main';
            this.displayUserListMenu();
            return;
        }
        
        // Import SudoCommand to check admin status
        const { SudoCommand } = require('../command/commands/sudo.command');
        const isAdmin = SudoCommand.isAuthorizedUser(username);
        
        console.clear();
        console.log(`\n=== Edit User: ${username} ===`);
        console.log(`Account created: ${new Date(user.joinDate || Date.now()).toLocaleDateString()}`);
        console.log(`Admin status: ${isAdmin ? '\x1b[32mADMIN\x1b[0m' : '\x1b[90mNOT ADMIN\x1b[0m'}`);
        console.log(`Flags: ${(user?.flags?.length  ?? 0) > 0 ? user?.flags?.join(', ') : 'None'}`);
        console.log("\n1. Manage user flags");
        console.log(`2. ${isAdmin ? 'Remove' : 'Grant'} admin privileges`);
        console.log("3. Reset user stats");
        console.log("4. Return to user list (or c/ESC)");
        
        console.log("\nPress number key to select option");
    }
    
    private displayEditUserFlagsMenu(username: string): void {
        // Get user data
        const user = this.userManager.getUser(username);
        if (!user) {
            console.log(`\nError: User ${username} not found.`);
            this.menuState.currentMenu = 'main';
            this.displayUserListMenu();
            return;
        }
        
        console.clear();
        console.log(`\n=== Manage Flags for User: ${username} ===`);
        console.log(`Current flags: ${(user?.flags?.length ?? 0) > 0 ? user?.flags?.join(', ') : 'None'}`);
        console.log("\n1. Add new flag");
        console.log("2. Remove existing flag");
        console.log("3. Return to edit menu (or c/ESC)");
        
        console.log("\nPress number key to select option");
    }
    
    private promptForFlagAdd(username: string): void {
        const user = this.userManager.getUser(username);
        if (!user) {
            console.log(`\nError: User ${username} not found.`);
            this.returnToUserAdminMenu(2000);
            return;
        }
        
        // Temporarily switch to line input mode
        process.stdin.removeAllListeners('data');
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
        
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        console.log("\nEnter flag to add (Ctrl+C to cancel):");

        rl.on('SIGINT', () => {
            rl.close();
            console.log("\nAdd flag cancelled.");
            this.returnToFlagsMenu(username);
        });

        rl.question('> ', (flag) => {
            rl.close();
            
            if (flag.trim()) {
                // Add the flag if it doesn't exist
                if (!user.flags) {
                    user.flags = [];
                }
                
                if (!user.flags.includes(flag.trim())) {
                    user.flags.push(flag.trim());
                    this.userManager.updateUser(username, user);
                    console.log(`\nFlag "${flag.trim()}" added to ${username}`);
                    systemLogger.info(`Admin added flag "${flag.trim()}" to user ${username}`);
                } else {
                    console.log(`\nFlag "${flag.trim()}" already exists on ${username}`);
                }
            } else {
                console.log("\nEmpty flag not added.");
            }
            
            // Return to flags menu after a short delay
            this.returnToFlagsMenu(username, 1500);
        });
    }
    
    private promptForFlagRemoval(username: string): void {
        const user = this.userManager.getUser(username);
        if (!user || !user.flags || user.flags.length === 0) {
            console.log(`\nNo flags to remove for user ${username}.`);
            this.returnToFlagsMenu(username, 1500);
            return;
        }
        
        // Temporarily switch to line input mode
        process.stdin.removeAllListeners('data');
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
        
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        console.log("\nSelect flag to remove (Ctrl+C to cancel):");
        user.flags.forEach((flag, i) => {
            console.log(`${i + 1}. ${flag}`);
        });

        rl.on('SIGINT', () => {
            rl.close();
            console.log("\nRemove flag cancelled.");
            this.returnToFlagsMenu(username);
        });
        
        rl.question(`Select flag (1-${user.flags.length}): `, (index) => {
            rl.close();
            
            const flagIndex = parseInt(index, 10) - 1;
            if (flagIndex >= 0 && flagIndex < (user?.flags?.length ?? 0)) {
                const flagToRemove = user?.flags?.[flagIndex];
                if (flagToRemove) { // Ensure flag exists at index
                    user.flags = user?.flags?.filter(f => f !== flagToRemove);
                    this.userManager.updateUser(username, user);
                    console.log(`\nFlag "${flagToRemove}" removed from ${username}`);
                    systemLogger.info(`Admin removed flag "${flagToRemove}" from user ${username}`);
                } else {
                    console.log("\nInvalid selection.");
                }
            } else {
                console.log("\nInvalid selection.");
            }
            
            // Return to flags menu after a short delay
            this.returnToFlagsMenu(username, 1500);
        });
    }
    
    private handleToggleAdminStatus(username: string): void {
        // Import SudoCommand to check admin status
        const { SudoCommand } = require('../command/commands/sudo.command');
        const isAdmin = SudoCommand.isAuthorizedUser(username);
        
        if (username.toLowerCase() === 'admin') {
            console.log("\nCannot change admin status for the built-in 'admin' user.");
            this.returnToEditMenu(username, 2000);
            return;
        }
        
        // Temporarily switch to line input mode
        process.stdin.removeAllListeners('data');
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
        
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log(`\nDo you want to ${isAdmin ? 'REMOVE' : 'GRANT'} admin privileges for ${username}? (y/n)`);

        rl.on('SIGINT', () => {
            rl.close();
            console.log("\nToggle admin status cancelled.");
            this.returnToEditMenu(username);
        });
        
        rl.question('> ', (answer) => {
            rl.close();
            
            if (answer.toLowerCase() === 'y') {
                try {
                    // Get command registry to add/remove admin
                    const commandRegistry = this.commandHandler.getCommandRegistry();
                    if (commandRegistry) {
                        const adminManageCmd = commandRegistry.getCommand('adminmanage');
                        if (adminManageCmd && (adminManageCmd as any).addAdmin && (adminManageCmd as any).removeAdmin) {
                            // Create a dummy admin client for context
                            const adminClientContext = { user: { username: 'console_admin' } } as ConnectedClient;

                            if (isAdmin) {
                                // Remove admin - cast to access the method
                                (adminManageCmd as any).removeAdmin(adminClientContext, username);
                                console.log(`\nRemoved admin privileges from ${username}`);
                                systemLogger.info(`Console admin removed admin privileges from ${username}`);
                            } else {
                                // Add admin with default level (MOD) - cast to access the method
                                (adminManageCmd as any).addAdmin(adminClientContext, username, 'mod');
                                console.log(`\nGranted admin privileges (MOD) to ${username}`);
                                systemLogger.info(`Console admin granted admin privileges (MOD) to ${username}`);
                            }
                        } else {
                            console.log("\nError: Could not find adminmanage command or its methods.");
                        }
                    } else {
                        console.log("\nError: Could not get command registry.");
                    }
                } catch (error) {
                    console.log(`\nError toggling admin status: ${error}`);
                    systemLogger.error(`Error toggling admin status for ${username}:`, error);
                }
            } else {
                console.log("\nAdmin status not changed.");
            }
            
            // Return to edit menu after a short delay
            this.returnToEditMenu(username, 1500);
        });
    }
    
    private handleResetUserStats(username: string): void {
        // Get current user
        const user = this.userManager.getUser(username);
        if (!user) {
            console.log(`\nError: User ${username} not found.`);
            this.returnToUserAdminMenu(2000);
            return;
        }
        
        // Temporarily switch to line input mode
        process.stdin.removeAllListeners('data');
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
        
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        console.log('\nWARNING: This will reset character stats (HP, attributes, level, XP, inventory, equipment, location).');
        console.log('Account info (username, password, flags, join date) will be kept.');

        rl.on('SIGINT', () => {
            rl.close();
            console.log("\nReset stats cancelled.");
            this.returnToEditMenu(username);
        });

        rl.question(`Type "confirm" to reset stats for ${username}: `, (answer) => {
            rl.close();
            
            if (answer.toLowerCase() === 'confirm') {
                try {
                    // Reset stats to defaults but keep account info
                    const resetUser = {
                        ...user, // Keep existing fields like password, joinDate, flags, etc.
                        // Reset gameplay stats
                        hp: 100, // Example default
                        maxHp: 100, // Example default
                        strength: 10, // Example default
                        dexterity: 10, // Example default
                        intelligence: 10, // Example default
                        // Use a fallback for STARTING_ROOM_ID since it's not in config
                        currentRoomId: 'start', // Default starting room ID
                        inventory: { items: [], currency: { gold: 0, silver: 0, copper: 0 } },
                        equipment: {},
                        experience: 0,
                        level: 1,
                        // Clear potentially problematic state data if needed
                        stateData: {}, 
                        // Clear pending messages? Optional.
                        // pendingAdminMessages: [], 
                    };
                    
                    this.userManager.updateUser(username, resetUser);
                    console.log(`\nStats reset for user ${username}`);
                    systemLogger.info(`Admin reset stats for user ${username}`);

                    // If user is online, notify them and potentially move them
                    if (this.userManager.isUserActive(username)) {
                        const targetClient = this.userManager.getActiveUserSession(username);
                        if (targetClient) {
                            targetClient.connection.write('\r\n\x1b[31mAn administrator has reset your character stats.\x1b[0m\r\n');
                            
                            // Use the handleCommand method instead of trying to use processCommand
                            this.commandHandler.handleCommand(targetClient, `teleport start`);
                        }
                    }

                } catch (error) {
                    console.log(`\nError resetting user stats: ${error}`);
                    systemLogger.error(`Error resetting stats for ${username}:`, error);
                }
            } else {
                console.log("\nStats reset cancelled.");
            }
            
            // Return to edit menu after a short delay
            this.returnToEditMenu(username, 1500);
        });
    }

    private handleChangePassword(username: string): void {
        // Check if user exists
        const user = this.userManager.getUser(username);
        if (!user) {
            console.log(`\nError: User ${username} not found.`);
            this.returnToUserAdminMenu(2000);
            return;
        }
        
        console.log(`\nChange password for user ${username}`);
        
        // Remove key handler and set raw mode off for readline
        process.stdin.removeAllListeners('data');
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
        
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        let newPassword = '';

        const getNewPassword = () => {
            rl.question('Enter new password (Ctrl+C to cancel): ', (pass) => {
                if (pass.length < config.MIN_PASSWORD_LENGTH) {
                    console.log(`Password must be at least ${config.MIN_PASSWORD_LENGTH} characters long.`);
                    getNewPassword(); // Ask again
                    return;
                }
                newPassword = pass;
                confirmNewPassword();
            });
        };

        const confirmNewPassword = () => {
            rl.question('Confirm new password: ', (confirmPass) => {
                rl.close(); // Close after getting confirmation

                if (newPassword === confirmPass) {
                    try {
                        const success = this.userManager.changeUserPassword(username, newPassword);
                        if (success) {
                            console.log(`\nPassword changed successfully for ${username}`);
                            systemLogger.info(`Admin changed password for user ${username}`);
                        } else {
                            console.log(`\nError changing password: User not found or update failed`);
                            systemLogger.error(`Failed to change password for ${username} via userManager`);
                        }
                    } catch (error) {
                        console.log(`\nError changing password: ${error}`);
                        systemLogger.error(`Error changing password for ${username}:`, error);
                    }
                } else {
                    console.log("\nPasswords don't match. Password not changed.");
                }
                
                // Return to main menu
                this.returnToUserAdminMenu(1500);
            });
        };

        rl.on('SIGINT', () => {
            rl.close();
            console.log("\nChange password cancelled.");
            this.returnToUserAdminMenu();
        });

        getNewPassword(); // Start the process
    }

    private handleDeleteUser(username: string): void {
        // Check if user exists
        const user = this.userManager.getUser(username);
        if (!user) {
            console.log(`\nError: User ${username} not found.`);
            this.returnToUserAdminMenu(2000);
            return;
        }
        
        // Don't allow deleting the built-in admin
        if (username.toLowerCase() === 'admin') {
            console.log("\nCannot delete the built-in 'admin' user.");
            this.returnToUserAdminMenu(2000);
            return;
        }
        
        console.log(`\n\x1b[31mWARNING:\x1b[0m You are about to delete user \x1b[1m${username}\x1b[0m`);
        console.log("This action CANNOT be undone and will remove all user data.");
        
        // Remove key handler and set raw mode off for readline
        process.stdin.removeAllListeners('data');
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
        
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.on('SIGINT', () => {
            rl.close();
            console.log("\nDelete user cancelled.");
            this.returnToUserAdminMenu();
        });
        
        rl.question(`Type "${username}" to confirm deletion: `, (confirmation) => {
            rl.close();
            
            if (confirmation === username) {
                try {
                    // Check if user is online first
                    if (this.userManager.isUserActive(username)) {
                        // Find the client and disconnect them
                        const clients = Array.from(this.clientManager.getClients().values());
                        const targetClient = clients.find(c => c.user && c.user.username === username);
                        
                        if (targetClient) {
                            targetClient.connection.write('\r\n\x1b[31mYour account is being deleted by an administrator.\x1b[0m\r\n');
                            setTimeout(() => targetClient.connection.end(), 500);
                        }
                    }
                    
                    // Delete the user
                    const deleted = this.userManager.deleteUser(username);
                    if (deleted) {
                        console.log(`\nUser ${username} has been deleted.`);
                        systemLogger.info(`Admin deleted user ${username}`);
                        // Refresh user list in menu state
                        this.menuState.allUsers = this.userManager.getAllUsers().sort((a, b) => 
                            a.username.toLowerCase().localeCompare(b.username.toLowerCase())
                        );
                        // Adjust selected index if necessary
                        if (this.menuState.selectedIndex >= this.menuState.allUsers.length) {
                            this.menuState.selectedIndex = Math.max(0, this.menuState.allUsers.length - 1);
                        }
                    } else {
                        console.log(`\nFailed to delete user ${username}.`);
                        systemLogger.error(`Failed to delete user ${username}`);
                    }
                } catch (error) {
                    console.log(`\nError deleting user: ${error}`);
                    systemLogger.error(`Error deleting user ${username}:`, error);
                }
            } else {
                console.log("\nConfirmation didn't match. User not deleted.");
            }
            
            // Return to main menu
            this.returnToUserAdminMenu(1500);
        });
    }

    // Helper to return to the main user admin menu list
    private returnToUserAdminMenu(delay: number = 0): void {
        setTimeout(() => {
            this.menuState.currentMenu = 'main';
            this.displayUserListMenu();
            // Re-attach listener
            process.stdin.removeAllListeners('data');
            process.stdin.on('data', this.handleMenuKeyPress.bind(this));
            if (process.stdin.isTTY) process.stdin.setRawMode(true);
        }, delay);
    }

    // Helper to return to the edit user menu
    private returnToEditMenu(username: string, delay: number = 0): void {
        setTimeout(() => {
            this.menuState.currentMenu = 'edit';
            this.displayEditUserMenu(username);
            // Re-attach listener
            process.stdin.removeAllListeners('data');
            process.stdin.on('data', this.handleMenuKeyPress.bind(this));
            if (process.stdin.isTTY) process.stdin.setRawMode(true);
        }, delay);
    }

    // Helper to return to the flags menu
    private returnToFlagsMenu(username: string, delay: number = 0): void {
        setTimeout(() => {
            this.menuState.currentMenu = 'flags';
            this.displayEditUserFlagsMenu(username);
            // Re-attach listener
            process.stdin.removeAllListeners('data');
            process.stdin.on('data', this.handleMenuKeyPress.bind(this));
            if (process.stdin.isTTY) process.stdin.setRawMode(true);
        }, delay);
    }
}