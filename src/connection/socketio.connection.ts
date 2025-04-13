import { Socket } from 'socket.io';
import { EventEmitter } from 'events';
import { IConnection } from './interfaces/connection.interface';
import { getSessionLogger, closeSessionLogger } from '../utils/rawSessionLogger';

export class SocketIOConnection extends EventEmitter implements IConnection {
  private socket: Socket;
  private id: string;
  private maskInput: boolean = false;
  private rawLoggingEnabled: boolean = true;
  private passwordMessageLogged: boolean = false;

  constructor(socket: Socket) {
    super();
    this.socket = socket;
    this.id = socket.id;
    this.setupListeners();
  }

  private setupListeners(): void {
    // Handle keypress events from the client
    this.socket.on('keypress', (data) => {
      // Log input only if we're not in password input mode
      if (this.rawLoggingEnabled && !this.maskInput) {
        const logger = getSessionLogger(this.id);
        logger.logInput(data);
      } 
      // For password input, log a single message indicating password entry
      else if (this.rawLoggingEnabled && this.maskInput && !this.passwordMessageLogged) {
        const logger = getSessionLogger(this.id);
        logger.logInput('[PASSWORD INPUT MASKED]');
        this.passwordMessageLogged = true;
      }

      this.emit('data', data);
    });

    // Handle special key events
    this.socket.on('special', (data) => {
      let keyCode = '';
      
      // For arrow keys and other special inputs
      if (data.key === 'up') {
        keyCode = '\u001b[A';
      } else if (data.key === 'down') {
        keyCode = '\u001b[B';
      } else if (data.key === 'left') {
        keyCode = '\u001b[D';
      } else if (data.key === 'right') {
        keyCode = '\u001b[C';
      }
      
      // Only log special keys for non-password input
      if (keyCode && this.rawLoggingEnabled && !this.maskInput) {
        const logger = getSessionLogger(this.id);
        logger.logInput(`[SPECIAL:${data.key}]`);
      }
      
      if (keyCode) {
        this.emit('data', keyCode);
      }
    });

    // Handle disconnect
    this.socket.on('disconnect', () => {
      if (this.rawLoggingEnabled) {
        closeSessionLogger(this.id);
      }
      this.emit('end');
    });

    // Handle errors
    this.socket.on('error', (err) => {
      if (this.rawLoggingEnabled) {
        const logger = getSessionLogger(this.id);
        logger.logOutput(`[ERROR] ${err.message}`);
      }
      this.emit('error', err);
    });
  }

  public write(data: string): void {
    // Log output if raw logging is enabled
    if (this.rawLoggingEnabled) {
      const logger = getSessionLogger(this.id);
      logger.logOutput(data);
    }
    
    // Now that we're using xterm.js, we can send raw ANSI codes directly
    // without converting to HTML - xterm.js will handle them natively
    this.socket.emit('output', { data });
  }

  public end(): void {
    if (this.rawLoggingEnabled) {
      closeSessionLogger(this.id);
    }
    this.socket.disconnect();
  }

  public getId(): string {
    return this.id;
  }

  public getType(): string {
    return 'websocket';
  }

  public setMaskInput(mask: boolean): void {
    // If we're turning masking on (entering password mode)
    if (mask && !this.maskInput) {
      this.maskInput = true;
      this.passwordMessageLogged = false;
    } 
    // If we're turning masking off (exiting password mode)
    else if (!mask && this.maskInput) {
      this.maskInput = false;
      
      // Log that password entry is complete
      if (this.rawLoggingEnabled) {
        const logger = getSessionLogger(this.id);
        logger.logInput('[PASSWORD INPUT COMPLETE]');
      }
    }
    
    this.socket.emit('mask', { mask });
  }

  public getRawConnection(): Socket {
    return this.socket;
  }

  // Enable or disable raw session logging
  public enableRawLogging(enabled: boolean): void {
    this.rawLoggingEnabled = enabled;
  }

  // Check if raw logging is enabled
  public isRawLoggingEnabled(): boolean {
    return this.rawLoggingEnabled;
  }

  // Expose the remote address
  get remoteAddress(): string {
    return this.socket.handshake.address || 'unknown';
  }
}
