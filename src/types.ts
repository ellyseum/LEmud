import { IConnection } from './connection/interfaces/connection.interface';
import { Currency } from './room/room';

// Define state enum
export enum ClientStateType {
  CONNECTING = 'connecting',
  LOGIN = 'login',
  SIGNUP = 'signup',
  CONFIRMATION = 'confirmation',
  AUTHENTICATED = 'authenticated',
  TRANSFER_REQUEST = 'transfer_request'  // New state for handling session transfers
}

export interface User {
  username: string;
  password: string;
  health: number;
  maxHealth: number;
  experience: number;
  level: number;
  joinDate: Date;
  lastLogin: Date;
  currentRoomId: string; // Add this field to track user's current room
  inventory: {
    items: string[];
    currency: Currency;
  };
  commandHistory?: string[]; // Store the user's command history (up to 30 entries)
  currentHistoryIndex?: number; // Current position in command history when browsing
  savedCurrentCommand?: string; // Save the current command when browsing history
}

export interface ConnectedClient {
  connection: IConnection; // Replace Socket with IConnection
  user: User | null;
  authenticated: boolean;
  buffer: string;
  state: ClientStateType;
  stateData: {
    maskInput?: boolean;
    username?: string;
    password?: string;
    awaitingPassword?: boolean;
    offerSignup?: boolean;
    transitionTo?: ClientStateType;
    waitingForTransfer?: boolean; // Flag to indicate this client is waiting for transfer approval
    transferredSession?: boolean; // Flag to indicate this session was transferred from another
    [key: string]: any;
  };
  
  // For output buffering
  isTyping: boolean;
  outputBuffer: string[];
  
  // Add connectedAt and lastActivity properties
  connectedAt: number;
  lastActivity: number;
}

export type StateHandler = (client: ConnectedClient, input: string) => void;

export interface ClientState {
  name: ClientStateType;
  enter: (client: ConnectedClient) => void;
  handle: StateHandler;
}

export interface ServerStats {
  startTime: Date;
  uptime: number; // in seconds
  connectedClients: number;
  authenticatedUsers: number;
  totalConnections: number;
  totalCommands: number;
  memoryUsage: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  }
}
