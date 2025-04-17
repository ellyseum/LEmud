import readline from 'readline';
import { UserManager } from '../user/userManager';
import { ClientManager } from '../client/clientManager';
import { ConnectedClient, User } from '../types'; // Import User type
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
  allUsers: User[]; // Use User[] instead of any[]
  editData?: Partial<User>; // Use Partial<User> instead of any
  userPendingDeletion?: string; // Add userPendingDeletion to track deletion
}

export class UserAdminMenu {
    private userManager: UserManager;
    private clientManager: ClientManager;
    private commandHandler: CommandHandler;
    private localSessionManager: LocalSessionManager;
    private telnetServer: TelnetServer;
    private gameServer: GameServer;
    private onMenuExit: () => void;
    private refreshIntervalId: NodeJS.Timeout | null = null;
    private isAwaitingInput: boolean = false; // Flag to track input state

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

    /**
     * Custom input handler to replace readline.question
     * Manages raw mode, character input, backspace, Enter, and Ctrl+C.
     */
    private promptForInput(
        prompt: string,
        callback: (answer: string) => void,
        cancelCallback: () => void = () => {},
        options: { hideInput?: boolean } = {}
    ): void {
        // Ensure previous listeners are removed and raw mode is off initially
        process.stdin.removeAllListeners('data');
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false); // Turn off raw mode before writing prompt
        }

        process.stdout.write(prompt); // Display the prompt

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
                        // Basic backspace handling for terminal
                        process.stdout.write('\b \b');
                    }
                    break;

                // Add handling for arrow keys, home, end etc. if needed (more complex)

                default:
                    // Handle printable characters
                    // Filter out non-printable control characters (except handled ones)
                    if (key >= ' ' && key <= '~') { // Basic printable ASCII range
                        // Insert character at cursor position
                        buffer = buffer.slice(0, cursorPosition) + key + buffer.slice(cursorPosition);
                        cursorPosition++;
                        // Echo character (or '*' if hiding input)
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
            // Don't pause stdin here, as the menu might need it immediately after
        };

        process.stdin.on('data', inputHandler);
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

        // Start auto-refresh timer
        this.clearRefreshTimer();
        this.refreshIntervalId = setInterval(() => {
            // Only refresh if the menu is active, on the main screen, AND not waiting for input
            if (this.menuState.active && this.menuState.currentMenu === 'main' && !this.isAwaitingInput) {
                this.refreshUserList(true);
            }
        }, 1000);
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

        this.clearRefreshTimer();
    }

    private clearRefreshTimer(): void {
        if (this.refreshIntervalId) {
            clearInterval(this.refreshIntervalId);
            this.refreshIntervalId = null;
        }
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
        else if (key.toLowerCase() === 'l') {
            this.clearRefreshTimer();
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
        else if (key.toLowerCase() === 'd') {
            // Delete selected user
            const selectedUser = allUsers[selectedIndex];
            if (selectedUser) {
                this.menuState.selectedUser = selectedUser.username;
                this.handleDeleteUser(selectedUser.username);
            }
        }
        else if (key.toLowerCase() === 'r') {
            // Refresh the user list
            this.refreshUserList();
        }
        else if (key.toLowerCase() === 'c') {
            // Cancel and return to main menu
            this.exitUserAdminMenu();
        }
    }
    
    private handleEditMenuKeyPress(key: string): void {
        if (key === '\u0003' || key.toLowerCase() === 'c') {
            console.log("\nEdit cancelled.");
            this.returnToUserAdminMenu(500);
            return;
        }

        const username = this.menuState.selectedUser;
        if (!username) {
            console.log("\nNo user selected for editing.");
            this.returnToUserAdminMenu(500);
            return;
        }

        switch(key.toLowerCase()) {
            case 's':
                this.saveUserEdits(username);
                break;
            case 'f':
                // Switch to flags menu
                this.menuState.currentMenu = 'flags';
                this.displayFlagsMenu(username);
                break;
            case 'c':
                console.log("\nEditing cancelled.");
                this.returnToUserAdminMenu(500);
                break;
        }
    }

    private handleFlagsMenuKeyPress(key: string): void {
        if (key === '\u0003' || key.toLowerCase() === 'c') {
            console.log("\nFlags edit cancelled.");
            // Return to edit menu
            this.menuState.currentMenu = 'edit';
            this.displayEditUserMenu(this.menuState.selectedUser);
            return;
        }

        const username = this.menuState.selectedUser;
        if (!username) {
            console.log("\nNo user selected for flag editing.");
            this.returnToUserAdminMenu(500);
            return;
        }

        // Get the user data
        const user: User | undefined = this.userManager.getUserByUsername(username);
        if (!user) {
            console.log(`\nUser ${username} not found.`);
            this.returnToUserAdminMenu(500);
            return;
        }

        // Ensure flags array exists
        if (!user.flags) {
            user.flags = [];
        }
        const currentFlags: string[] = user.flags; // Explicitly string[]

        // Define the toggleable flags (adjust as needed)
        const toggleableFlags = ['admin', 'builder', 'immortal', 'developer'];

        // Handle number keys to toggle flags
        if (key >= '1' && key <= toggleableFlags.length.toString()) {
            const flagIndex = parseInt(key) - 1;
            const flagName = toggleableFlags[flagIndex];
            
            // Toggle the flag in the string array
            const flagExists = currentFlags.includes(flagName);
            if (flagExists) {
                user.flags = currentFlags.filter(f => f !== flagName); // Assign filtered array
                console.log(`\nToggled flag ${flagName}: OFF`);
            } else {
                // Create a new array with the added flag to ensure immutability if needed,
                // or simply push if direct mutation is okay.
                user.flags = [...currentFlags, flagName]; // Use spread syntax for clarity
                console.log(`\nToggled flag ${flagName}: ON`);
            }
            
            // Update the display immediately
            this.displayFlagsMenu(username);
        } else if (key.toLowerCase() === 's') {
            // Save flags (pass the string array)
            this.saveUserFlags(username, user.flags); // user.flags is guaranteed string[] here
        } else if (key.toLowerCase() === 'b') {
            // Go back to edit menu
            this.menuState.currentMenu = 'edit';
            this.displayEditUserMenu(username);
        }
    }
    
    private displayUserListMenu(): void {
        const { selectedIndex, currentPage, allUsers, userPendingDeletion } = this.menuState;
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
        console.log("Navigate: ↑/↓ keys | Actions: force (l)ogin, (k)ick user, admin (m)essage, (e)dit user, change (p)assword, (d)elete user, (r)efresh, (c)ancel");
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
            
            // Add deletion indicator if this user is pending deletion
            if (user.username === userPendingDeletion) {
                userDisplay += ' \x1b[31m(DELETING...)\x1b[0m'; // Red indicator
            }
            
            if (isSelected) {
                console.log(`\x1b[47m\x1b[30m${userDisplay}\x1b[0m`); // White background, black text
            } else {
                console.log(userDisplay);
            }
        }
        
        console.log("\nPress letter key for action or (c)ancel / Ctrl+C");
    }

    private refreshUserList(isAutoRefresh: boolean = false): void {
        // Get all registered users and sort alphabetically
        const allUsers = this.userManager.getAllUsers().sort((a, b) => 
            a.username.toLowerCase().localeCompare(b.username.toLowerCase())
        );
        
        // Update the state
        this.menuState.allUsers = allUsers;
        
        // Only reset selection/page if it's NOT an auto-refresh
        // to avoid disrupting user navigation during auto-refresh.
        if (!isAutoRefresh) {
            this.menuState.selectedIndex = 0; // Reset selection to the top
            this.menuState.currentPage = 0;   // Reset page to the first page
        } else {
            // For auto-refresh, ensure selectedIndex is still valid
            if (this.menuState.selectedIndex >= allUsers.length) {
                this.menuState.selectedIndex = Math.max(0, allUsers.length - 1);
            }
            // Ensure currentPage is still valid
            const usersPerPage = 10;
            const totalPages = Math.ceil(allUsers.length / usersPerPage);
            if (this.menuState.currentPage >= totalPages) {
                this.menuState.currentPage = Math.max(0, totalPages - 1);
            }
            // Adjust selectedIndex if it falls outside the current page after potential user removal
            const startIndex = this.menuState.currentPage * usersPerPage;
            const endIndex = startIndex + usersPerPage;
            if (this.menuState.selectedIndex < startIndex || this.menuState.selectedIndex >= endIndex) {
                 // If selection is outside current page view after refresh, reset to top of current page
                 this.menuState.selectedIndex = startIndex; 
            }
        }
        
        // Redisplay the menu
        // Only redisplay if it's not an auto-refresh OR if the list content actually changed
        // (This check might be complex, for now, always redisplay on manual refresh)
        if (!isAutoRefresh) {
            this.displayUserListMenu();
        } else {
            // For auto-refresh, only redisplay if the menu is currently active and showing the main list
            if (this.menuState.active && this.menuState.currentMenu === 'main') {
                this.displayUserListMenu();
            }
        }
    }

    private returnToUserAdminMenu(delay: number = 0): void {
        setTimeout(() => {
            this.menuState.currentMenu = 'main';
            this.displayUserListMenu();
            process.stdin.removeAllListeners('data');
            process.stdin.on('data', this.handleMenuKeyPress.bind(this));
            if (process.stdin.isTTY) process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.setEncoding('utf8');

            // Restart the refresh timer
            this.clearRefreshTimer();
            this.refreshIntervalId = setInterval(() => {
                if (this.menuState.active && this.menuState.currentMenu === 'main' && !this.isAwaitingInput) {
                    this.refreshUserList(true);
                }
            }, 1000);
        }, delay);
    }

    private returnToEditMenu(username: string, delay: number = 0): void {
        setTimeout(() => {
            this.menuState.currentMenu = 'edit';
            this.displayEditUserMenu(username);
        }, delay);
    }

    // --- Implementation of missing methods ---

    private handleDirectLogin(username: string): void {
        console.log(`\nAttempting direct login as user: ${username}...`);
        
        // Find the user
        const user = this.userManager.getUserByUsername(username);
        if (!user) {
            console.log(`User ${username} not found.`);
            this.returnToUserAdminMenu(1500);
            return;
        }

        // Check if user is already logged in
        const existingClient = this.clientManager.getClientByUsername(username);
        if (existingClient) {
            console.log(`User ${username} is already logged in.`);
            this.isAwaitingInput = true; // Set flag before prompt
            this.promptForInput(
                `\nUser ${username} is already online. Take over their session? (y/n): `,
                (answer) => {
                    this.isAwaitingInput = false; // Clear flag in callback
                    if (answer.toLowerCase() === 'y') {
                        console.log(`Taking over ${username}'s session...`);
                        // Disconnect the existing client
                        existingClient.connection.write('\r\n\x1b[33mAn admin is taking over your session.\x1b[0m\r\n');
                        existingClient.connection.end();
                        
                        // Wait a moment before creating new session
                        setTimeout(() => {
                            this.createLocalAdminSession(username);
                        }, 500);
                    } else {
                        console.log("Taking over session cancelled.");
                        this.returnToUserAdminMenu(1000);
                    }
                },
                () => {
                    this.isAwaitingInput = false; // Clear flag in cancel callback
                    this.returnToUserAdminMenu();
                }
            );
            return;
        }

        // Create local admin session
        this.createLocalAdminSession(username);
    }

    private createLocalAdminSession(username: string): void {
        try {
            // Clear menu state and intervals
            this.clearRefreshTimer();
            this.menuState.active = false;
            
            // Restore console logging
            if (this._userAdminConsoleTransport) {
                if (Array.isArray(this._userAdminConsoleTransport)) {
                    this._userAdminConsoleTransport.forEach(transport => {
                        systemLogger.add(transport);
                    });
                } else {
                    systemLogger.add(this._userAdminConsoleTransport);
                }
                this._userAdminConsoleTransport = null;
            }

            // Create console session
            systemLogger.info(`Admin initiated direct login as user: ${username}`);
            this.localSessionManager.createConsoleSession(username, true);
            
            // Don't call onMenuExit as the local session will handle console
        } catch (error) {
            console.error(`Error initiating console session as ${username}:`, error);
            systemLogger.error(`Failed admin direct login as ${username}: ${error}`);
            this.returnToUserAdminMenu(1000);
        }
    }

    private handleKickUser(username: string): void {
        console.log(`\nAttempting to kick user: ${username}...`);
        
        // Check if user is online
        const client = this.clientManager.getClientByUsername(username);
        if (!client) {
            console.log(`\nUser ${username} is not currently online.`);
            this.returnToUserAdminMenu(1500);
            return;
        }
        
        // Confirm kick
        this.isAwaitingInput = true; // Set flag
        this.promptForInput(
            `\nAre you sure you want to kick ${username}? (y/n): `,
            (answer) => {
                this.isAwaitingInput = false; // Clear flag
                if (answer.toLowerCase() === 'y') {
                    console.log(`\nKicking user: ${username}`);
                    
                    // Send message to user before disconnecting
                    client.connection.write('\r\n\x1b[31mYou have been kicked by an administrator.\x1b[0m\r\n');
                    
                    // Log the action
                    systemLogger.info(`Admin kicked user: ${username}`);
                    
                    // Disconnect the client
                    setTimeout(() => {
                        client.connection.end();
                        console.log(`User ${username} has been kicked.`);
                        this.returnToUserAdminMenu(1000);
                    }, 500);
                } else {
                    console.log("\nKick cancelled.");
                    this.returnToUserAdminMenu(1000);
                }
            },
            () => {
                this.isAwaitingInput = false; // Clear flag
                this.returnToUserAdminMenu();
            }
        );
    }

    private handleSendAdminMessage(username: string): void {
        console.log(`\nPrepare message for user: ${username}...`);
        
        // Check if user is online
        const client = this.clientManager.getClientByUsername(username);
        if (!client) {
            console.log(`\nUser ${username} is not currently online.`);
            this.returnToUserAdminMenu(1500);
            return;
        }
        
        // Prompt for message
        this.isAwaitingInput = true; // Set flag
        this.promptForInput(
            `\nEnter message to send to ${username} (Ctrl+C to cancel): `,
            (message) => {
                this.isAwaitingInput = false; // Clear flag
                if (message.trim()) {
                    console.log(`\nSending message to ${username}: "${message}"`);
                    
                    // Create a boxed message for the user
                    const boxedMessage = createAdminMessageBox(message);
                    
                    // Send the message
                    client.connection.write(boxedMessage);
                    
                    // Redisplay the prompt for the user
                    const promptText = getPromptText(client);
                    client.connection.write(promptText);
                    if (client.buffer.length > 0) {
                        client.connection.write(client.buffer);
                    }
                    
                    // Log the action
                    systemLogger.info(`Admin sent message to user ${username}: ${message}`);
                    console.log(`Message sent to ${username}.`);
                } else {
                    console.log("\nMessage was empty, not sent.");
                }
                this.returnToUserAdminMenu(1000);
            },
            () => {
                this.isAwaitingInput = false; // Clear flag
                this.returnToUserAdminMenu();
            }
        );
    }

    private displayEditUserMenu(username: string): void {
        console.clear();
        
        // Get user data
        const user: User | undefined = this.userManager.getUserByUsername(username);
        if (!user) {
            console.log(`\nError: User ${username} not found.`);
            this.returnToUserAdminMenu(1500);
            return;
        }
        
        // Store user data for editing - ensure it's Partial<User>
        this.menuState.editData = { ...user } as Partial<User>; 
        
        // Display edit form with nullish coalescing for optional fields
        console.log(`\n=== Edit User: ${username} ===`);
        console.log(`Email: ${user.email ?? '(not set)'}`);
        console.log(`Role: ${user.role ?? 'player'}`);
        console.log(`Last login: ${user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never'}`);
        // Ensure 'created' is treated as Date or undefined before calling toLocaleString
        const createdDate = user.created ? (typeof user.created === 'string' ? new Date(user.created) : user.created) : undefined;
        console.log(`Created: ${createdDate ? createdDate.toLocaleString() : 'Unknown'}`);
        console.log(`Description: ${user.description ?? '(not set)'}`);
        console.log(`\nFlags: ${user.flags?.join(', ') ?? '(none)'}`); // Use ?? for flags as well
            
        console.log("\n=== Actions ===");
        console.log("(s)ave, (f)lags, (c)ancel / Ctrl+C");
        
        // Set up event handler for edit menu
        process.stdin.removeAllListeners('data');
        process.stdin.on('data', this.handleMenuKeyPress.bind(this));
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
    }

    private displayFlagsMenu(username: string): void {
        console.clear();
        
        // Get user data
        const user = this.userManager.getUserByUsername(username);
        if (!user) {
            console.log(`\nError: User ${username} not found.`);
            this.returnToUserAdminMenu(1500);
            return;
        }
        
        // Display flags
        console.log(`\n=== User Flags: ${username} ===`);
        console.log("Toggle flags by pressing the corresponding number");
        console.log("");
        
        // Ensure flags array exists
        const currentFlags = user.flags || [];
        
        // Define the toggleable flags (should match handleFlagsMenuKeyPress)
        const toggleableFlags = ['admin', 'builder', 'immortal', 'developer'];
        
        // Display toggleable flags
        toggleableFlags.forEach((flagName, index) => {
            const value = currentFlags.includes(flagName);
            console.log(`${index + 1}. ${flagName}: ${value ? 'ON' : 'off'}`);
        });

        // Display other non-toggleable flags (if any)
        const otherFlags = currentFlags.filter(f => !toggleableFlags.includes(f));
        if (otherFlags.length > 0) {
            console.log("\nOther Flags (read-only):");
            otherFlags.forEach(flagName => {
                console.log(`- ${flagName}`);
            });
        }
            
        console.log("\n=== Actions ===");
        console.log("Press flag number to toggle, (s)ave, (b)ack to edit menu, (c)ancel / Ctrl+C");
        
        // Set up event handler for flags menu
        process.stdin.removeAllListeners('data');
        process.stdin.on('data', this.handleMenuKeyPress.bind(this));
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
    }

    private handleChangePassword(username: string): void {
        console.log(`\nChange password for user: ${username}...`);
        
        this.isAwaitingInput = true; // Set flag
        this.promptForInput(
            `\nEnter new password for ${username} (Ctrl+C to cancel): `,
            (password) => {
                this.isAwaitingInput = false; // Clear flag after first input
                if (!password || password.length < 4) {
                    console.log("\nPassword must be at least 4 characters.");
                    this.returnToUserAdminMenu(1500);
                    return;
                }
                
                // Confirm the password
                this.isAwaitingInput = true; // Set flag for second input
                this.promptForInput(
                    `Confirm new password: `,
                    async (confirmPassword) => {
                        this.isAwaitingInput = false; // Clear flag
                        if (password !== confirmPassword) {
                            console.log("\nPasswords do not match.");
                            this.returnToUserAdminMenu(1500);
                            return;
                        }
                        
                        try {
                            // Update the password
                            await this.userManager.updateUserPassword(username, password);
                            console.log(`\nPassword for ${username} updated successfully.`);
                            systemLogger.info(`Admin changed password for user: ${username}`);
                        } catch (error) {
                            console.error(`\nError changing password: ${error}`);
                            systemLogger.error(`Admin password change failed for ${username}: ${error}`);
                        }
                        
                        this.returnToUserAdminMenu(1500);
                    },
                    () => {
                        this.isAwaitingInput = false; // Clear flag
                        this.returnToUserAdminMenu();
                    },
                    { hideInput: true }
                );
            },
            () => {
                this.isAwaitingInput = false; // Clear flag
                this.returnToUserAdminMenu();
            },
            { hideInput: true }
        );
    }

    private handleDeleteUser(username: string): void {
        console.log(`\nDelete user: ${username}...`);
        
        // Prevent deleting the primary admin account
        if (config.adminUsername && username.toLowerCase() === config.adminUsername.toLowerCase()) {
            console.log(`\nCannot delete the primary admin account (${config.adminUsername}).`);
            this.returnToUserAdminMenu(1500);
            return;
        }
        
        // Show warning and confirm
        this.isAwaitingInput = true; // Set flag
        this.promptForInput(
            `\n\x1b[31mWARNING: This will permanently delete user ${username} and all their data.\x1b[0m\nType the username to confirm: `,
            async (confirmation) => {
                this.isAwaitingInput = false; // Clear flag
                if (confirmation.toLowerCase() !== username.toLowerCase()) {
                    console.log("\nUsername didn't match. Delete cancelled.");
                    this.returnToUserAdminMenu(1500);
                    return;
                }
                
                try {
                    // Check if user is online and kick them
                    const client = this.clientManager.getClientByUsername(username);
                    if (client) {
                        client.connection.write('\r\n\x1b[31mYour account is being deleted by an administrator.\x1b[0m\r\n');
                        client.connection.end();
                        console.log(`\nKicked ${username} before deletion.`);
                        // Small delay to allow the disconnect to process
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                    
                    // Mark user as pending deletion
                    this.menuState.userPendingDeletion = username;
                    this.displayUserListMenu();

                    // Delete the user
                    await this.userManager.deleteUser(username);
                    console.log(`\nUser ${username} deleted successfully.`);
                    systemLogger.info(`Admin deleted user: ${username}`);
                } catch (error) {
                    console.error(`\nError deleting user: ${error}`);
                    systemLogger.error(`Admin deletion failed for ${username}: ${error}`);
                } finally {
                    // Clear pending deletion state
                    this.menuState.userPendingDeletion = undefined;
                    this.returnToUserAdminMenu(1500);
                }
            },
            () => {
                this.isAwaitingInput = false; // Clear flag
                this.returnToUserAdminMenu();
            }
        );
    }

    private saveUserEdits(username: string): void {
        console.log(`\nSaving changes for ${username}...`);

        // Get the edited data
        const editData: Partial<User> = this.menuState.editData || {};

        // Create a payload for the update, explicitly removing username
        // as updateUser preserves the original username based on the first argument.
        const updatePayload = { ...editData };
        delete updatePayload.username; // Ensure username is not in the partial update data

        try {
            // Call updateUser with the payload excluding username
            this.userManager.updateUser(username, updatePayload);
            console.log(`\nUser ${username} updated successfully.`);
            systemLogger.info(`Admin edited user: ${username}`);
        } catch (error) {
            console.error(`\nError updating user: ${error}`);
            systemLogger.error(`Admin edit failed for ${username}: ${error}`);
        }

        this.returnToUserAdminMenu(1500);
    }

    private saveUserFlags(username: string, flags: string[]): void {
        console.log(`\nSaving flags for ${username}...`);
        
        try {
            // Get current user data
            const user = this.userManager.getUserByUsername(username);
            if (!user) {
                throw new Error(`User ${username} not found`);
            }
            
            // Update flags (assign the string array)
            user.flags = flags;
            this.userManager.updateUser(username, user);
            
            console.log(`\nFlags for ${username} updated successfully.`);
            systemLogger.info(`Admin updated flags for user: ${username}`);
            
            // Return to edit menu
            this.menuState.currentMenu = 'edit';
            this.displayEditUserMenu(username);
        } catch (error) {
            console.error(`\nError updating flags: ${error}`);
            systemLogger.error(`Admin flag update failed for ${username}: ${error}`);
            this.returnToUserAdminMenu(1500);
        }
    }
}