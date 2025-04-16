import net from 'net';
import { systemLogger } from '../utils/logger';
import { TelnetServer } from '../server/telnetServer';
import { ConsoleManager } from './consoleManager';
import config from '../config';

export class LocalSessionManager {
    private consoleManager: ConsoleManager;
    private telnetServer: TelnetServer;

    private isLocalClientConnected: boolean = false;
    private localClientSocket: net.Socket | null = null;
    private originalConsoleTransport: any = null;

    constructor(consoleManager: ConsoleManager, telnetServer: TelnetServer) {
        this.consoleManager = consoleManager;
        this.telnetServer = telnetServer;
    }

    public getIsLocalClientConnected(): boolean {
        return this.isLocalClientConnected;
    }

    public setOriginalConsoleTransport(transport: any): void {
        this.originalConsoleTransport = transport;
    }

    public getLocalClientSocket(): net.Socket | null {
        return this.localClientSocket;
    }

    public prepareLocalSessionStart(): boolean {
        if (this.isLocalClientConnected || !process.stdin.isTTY) return false;

        this.isLocalClientConnected = true;
        systemLogger.info("Attempting to start local session...");

        // Pause the main key listener via ConsoleManager
        this.consoleManager.removeMainKeyListener();
        process.stdin.removeAllListeners('data'); // Ensure all listeners are removed

        // Find and remove the console transport
        const winston = require('winston');
        const consoleTransports = systemLogger.transports.filter((t: any) =>
            t instanceof winston.transports.Console
        );

        if (consoleTransports.length > 0) {
            this.originalConsoleTransport = consoleTransports;
            consoleTransports.forEach(transport => {
                systemLogger.remove(transport);
            });
            console.log("\nConsole logging paused. Connecting to local server...");
            console.log("Press Ctrl+C to disconnect the local client and resume logging.");
            console.log('========================================');
            console.log('       CONNECTING LOCALLY...');
            console.log('========================================');
        } else {
            console.log("\nCould not find console transport to pause logging.");
        }
        return true;
    }

    public endLocalSession(): void {
        if (!this.isLocalClientConnected) return;

        systemLogger.info('Ending local session...');

        // Clean up socket
        if (this.localClientSocket) {
            this.localClientSocket.removeAllListeners();
            this.localClientSocket.destroy();
            this.localClientSocket = null;
        }

        // Restore console logging
        const winston = require('winston');
        if (this.originalConsoleTransport) {
            if (Array.isArray(this.originalConsoleTransport)) {
                this.originalConsoleTransport.forEach(transport => {
                    if (!systemLogger.transports.some((t: any) => t === transport)) {
                        systemLogger.add(transport);
                    }
                });
            } else if (!systemLogger.transports.some((t: any) => t === this.originalConsoleTransport)) {
                systemLogger.add(this.originalConsoleTransport);
            }
            systemLogger.info('Console logging restored.');
            this.originalConsoleTransport = null;
        }

        // Remove the specific listener for the session
        process.stdin.removeAllListeners('data');

        // Set stdin back to normal mode
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
            process.stdin.pause();
        }

        this.isLocalClientConnected = false;
        this.telnetServer.setAdminLoginPending(false);
        this.telnetServer.setForcedSessionUsername('');

        if (!config.SILENT_MODE) {
            console.log("\nLocal session ended. Log output resumed.");
        }

        // Re-enable the listener for the keys via ConsoleManager
        this.consoleManager.setupKeyListener();
    }

    public startLocalClientSession(port: number): void {
        if (!this.prepareLocalSessionStart()) return;

        this.localClientSocket = new net.Socket();

        this.localClientSocket.on('data', (data) => {
            process.stdout.write(data);
        });

        this.localClientSocket.on('close', () => {
            console.log('\nConnection to local server closed.');
            this.endLocalSession();
        });

        this.localClientSocket.on('error', (err) => {
            console.error(`\nLocal connection error: ${err.message}`);
            this.endLocalSession();
        });

        this.localClientSocket.connect(port, 'localhost', () => {
            systemLogger.info(`Local client connected to localhost:${port}`);
            console.log(`\nConnected to MUD server on port ${port}.`);

            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
                process.stdin.resume();
                process.stdin.setEncoding('utf8');

                process.stdin.on('data', (key) => {
                    if (key.toString() === '\u0003') {
                        console.log('\nCtrl+C detected. Disconnecting local client...');
                        this.endLocalSession();
                    } else if (this.localClientSocket && this.localClientSocket.writable) {
                        this.localClientSocket.write(key);
                    }
                });
            }
        });
    }

    public startLocalAdminSession(port: number): void {
        if (!this.prepareLocalSessionStart()) return;

        this.telnetServer.setAdminLoginPending(true);
        this.localClientSocket = new net.Socket();

        this.localClientSocket.on('data', (data) => {
            process.stdout.write(data);
        });

        this.localClientSocket.on('close', () => {
            console.log('\nAdmin session connection closed.');
            this.endLocalSession();
        });

        this.localClientSocket.on('error', (err) => {
            console.error(`\nLocal admin connection error: ${err.message}`);
            this.telnetServer.setAdminLoginPending(false);
            this.endLocalSession();
        });

        this.localClientSocket.connect(port, 'localhost', () => {
            systemLogger.info(`Local admin client connected to localhost:${port}`);
            console.log(`\nConnected directly as admin on port ${port}.`);

            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
                process.stdin.resume();
                process.stdin.setEncoding('utf8');

                process.stdin.on('data', (key) => {
                    if (key.toString() === '\u0003') {
                        console.log('\nCtrl+C detected. Disconnecting admin session...');
                        this.endLocalSession();
                    } else if (this.localClientSocket && this.localClientSocket.writable) {
                        this.localClientSocket.write(key);
                    }
                });
            }
        });
    }

    public startLocalUserSession(port: number, username?: string): void {
        if (!this.prepareLocalSessionStart()) return;

        this.localClientSocket = new net.Socket();

        this.localClientSocket.on('data', (data) => {
            process.stdout.write(data);
        });

        this.localClientSocket.on('close', () => {
            console.log('\nUser session connection closed.');
            this.endLocalSession();
        });

        this.localClientSocket.on('error', (err) => {
            console.error(`\nLocal user connection error: ${err.message}`);
            this.endLocalSession();
        });

        this.localClientSocket.connect(port, 'localhost', () => {
            systemLogger.info(`Local user client connected to localhost:${port} as ${username || 'anonymous'}`);
            console.log(`\nConnected as regular user${username ? ' ' + username : ''} on port ${port}.`);

            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
                process.stdin.resume();
                process.stdin.setEncoding('utf8');

                process.stdin.on('data', (key) => {
                    if (key.toString() === '\u0003') {
                        console.log('\nCtrl+C detected. Disconnecting user session...');
                        this.endLocalSession();
                    } else if (this.localClientSocket && this.localClientSocket.writable) {
                        this.localClientSocket.write(key);
                    }
                });
            }
        });
    }

    public startForcedSession(port: number, username: string): Promise<void> {
        return new Promise((resolve, reject) => {
            systemLogger.info(`Starting forced session as user: ${username}`);

            this.localClientSocket = new net.Socket();
            let loginState = 'waiting'; // States: waiting, username, password, connected
            let buffer = '';
            let dataHandled = false;
            let lastDataTime = Date.now();
            let loginTimeout: NodeJS.Timeout | null = null;

            // Set flag to let telnet server know this is a forced session
            this.telnetServer.setForcedSessionUsername(username);

            const cleanupAndReject = (error: Error) => {
                if (loginTimeout) clearTimeout(loginTimeout);
                this.telnetServer.setForcedSessionUsername(''); // Clear flag
                this.endLocalSession(); // Use the standard end session logic
                reject(error);
            };

            this.localClientSocket.on('data', (data) => {
                const dataStr = data.toString();
                buffer += dataStr;
                process.stdout.write(data);
                lastDataTime = Date.now();

                systemLogger.debug(`[ForcedSession] Received data in state ${loginState}: ${dataStr.replace(/\r\n/g, '\\r\\n')}`);

                if (loginState !== 'connected' && !dataHandled) {
                    if (buffer.includes('>') || buffer.includes('Welcome back') || buffer.includes('You are in') || buffer.includes('logged in')) {
                        loginState = 'connected';
                        systemLogger.info(`Forced session successfully logged in as ${username}`);
                        if (loginTimeout) clearTimeout(loginTimeout);
                        
                        // Set up stdin for the session
                        if (process.stdin.isTTY) {
                            process.stdin.setRawMode(true);
                            process.stdin.resume();
                            process.stdin.setEncoding('utf8');
                            process.stdin.removeAllListeners('data'); 

                            process.stdin.on('data', (key) => {
                                if (key.toString() === '\u0003') {
                                    console.log('\nCtrl+C detected. Disconnecting forced session...');
                                    this.endLocalSession();
                                } else if (this.localClientSocket && this.localClientSocket.writable) {
                                    this.localClientSocket.write(key);
                                }
                            });
                        }
                        resolve();
                        return;
                    }

                    // Check for username prompt
                    if (loginState === 'waiting' && (buffer.includes('Username:') || buffer.includes('login:') || buffer.includes('name:'))) {
                        systemLogger.info(`Forced session detected username prompt, sending: ${username}`);
                        this.localClientSocket?.write(`${username}\n`);
                        loginState = 'username';
                        buffer = '';
                        dataHandled = true;
                    }
                    // Check for password prompt
                    else if ((loginState === 'username' || loginState === 'waiting') && 
                        (buffer.includes('Password:') || buffer.includes('password:'))) {
                        systemLogger.info(`Forced session detected password prompt for ${username}, sending placeholder`);
                        this.localClientSocket?.write(`forcedlogin\n`);
                        loginState = 'password';
                        buffer = '';
                        dataHandled = true;
                    }
                    // Check for login failure
                    else if ((loginState === 'username' || loginState === 'password') && 
                        (buffer.includes('Invalid') || buffer.includes('failed') || buffer.includes('incorrect'))) {
                        const error = new Error(`Authentication failed during forced session for user: ${username}`);
                        systemLogger.error(error.message);
                        cleanupAndReject(error);
                        return;
                    }
                }
                
                dataHandled = false;
            });

            this.localClientSocket.on('close', () => {
                console.log('\nForced session connection closed.');
                if (loginState !== 'connected') {
                    cleanupAndReject(new Error('Connection closed before login completed'));
                } else {
                    this.endLocalSession();
                }
            });

            this.localClientSocket.on('error', (err) => {
                console.error(`\nForced session connection error: ${err.message}`);
                systemLogger.error(`Forced session error for ${username}: ${err.message}`);
                cleanupAndReject(err);
            });

            this.localClientSocket.connect(port, 'localhost', () => {
                systemLogger.info(`Forced session socket connected to localhost:${port} for user ${username}`);
                console.log(`\nStarting forced session as ${username}...`);
                lastDataTime = Date.now();

                // Start the inactivity timeout checker
                const timeoutCheck = () => {
                    const currentTime = Date.now();
                    const timeSinceLastData = currentTime - lastDataTime;
                    
                    if (loginState !== 'connected') {
                        if (timeSinceLastData > 20000) { // 20 second timeout
                            systemLogger.error(`Forced session login timeout for user: ${username}`);
                            cleanupAndReject(new Error('Login timeout for forced session'));
                        } else {
                            loginTimeout = setTimeout(timeoutCheck, 1000);
                        }
                    }
                };
                loginTimeout = setTimeout(timeoutCheck, 1000);
            });
        });
    }
}