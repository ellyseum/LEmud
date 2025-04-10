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

// Define equipment slots
export enum EquipmentSlot {
  HEAD = 'head',
  NECK = 'neck',
  CHEST = 'chest',
  BACK = 'back',
  ARMS = 'arms',
  HANDS = 'hands',
  FINGER = 'finger',
  WAIST = 'waist',
  LEGS = 'legs',
  FEET = 'feet',
  MAIN_HAND = 'mainHand',
  OFF_HAND = 'offHand'
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

// Define GameItem interface for equipment
export interface GameItem {
  id: string;
  name: string;
  description: string;
  type: 'weapon' | 'armor' | 'consumable' | 'quest' | 'misc';
  slot?: EquipmentSlot; // Where the item is equipped, using the EquipmentSlot enum
  value: number; // Currency value
  weight?: number;
  stats?: {
    attack?: number;
    defense?: number;
    strength?: number;
    dexterity?: number;
    agility?: number;
    constitution?: number;
    wisdom?: number;
    intelligence?: number;
    charisma?: number;
  };
  requirements?: {
    level?: number;
    strength?: number;
    dexterity?: number;
  };
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
  // Add character statistics
  strength: number;
  dexterity: number;
  agility: number;
  constitution: number; // New stat for physical endurance
  wisdom: number;
  intelligence: number;
  charisma: number;
  // Combat stats
  attack?: number; // Calculated from equipment
  defense?: number; // Calculated from equipment
  // Equipment slots
  equipment?: {
    [slot: string]: string; // Maps slot name to item ID
  };
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
  isUnconscious?: boolean; // Add unconscious status
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

  cursorPos?: number; // Track cursor position within the buffer
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
