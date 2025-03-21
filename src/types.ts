import { IConnection } from './connection/interfaces/connection.interface';

// Define state enum
export enum ClientStateType {
  CONNECTING = 'connecting',
  LOGIN = 'login',
  SIGNUP = 'signup',
  CONFIRMATION = 'confirmation',
  AUTHENTICATED = 'authenticated',
  TRANSFER_REQUEST = 'transfer_request'  // New state for handling session transfers
}

// Define Item interface
export interface Item {
  name: string;
  description?: string;
}

// Define Exit interface
export interface Exit {
  direction: string;
  roomId: string;
}

// Define Currency interface
export interface Currency {
  gold: number;
  silver: number;
  copper: number;
}

export interface User {
  username: string;
  password?: string; // Making optional for backward compatibility
  passwordHash?: string;
  salt?: string;
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
  inCombat?: boolean; // Add combat status
}

export interface ConnectedClient {
  id: string; // Make sure clients have an ID property for lookup
  connection: IConnection; // Replace Socket with IConnection
  user: User | null;
  authenticated: boolean;
  buffer: string;
  state: ClientStateType;
  stateData: Record<string, any>;
  
  // For output buffering
  isTyping: boolean;
  outputBuffer: string[];
  
  // For idle disconnection and monitoring
  connectedAt: number;
  lastActivity: number;
  isBeingMonitored: boolean;
  adminMonitorSocket?: any;
  
  // Add tempUsername property
  tempUsername?: string;
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

export interface Room {
  id: string;
  name: string;
  description: string;
  exits: Exit[];
  players: string[];
  items: Item[];
  currency: {
    gold: number;
    silver: number;
    copper: number;
  };
  npcs?: string[]; // Add NPCs array to track monsters in the room
}
