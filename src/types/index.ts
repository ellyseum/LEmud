export enum ClientStateType {
  CONNECTING = 'connecting',
  LOGIN = 'login',
  SIGNUP = 'signup',
  AUTHENTICATED = 'authenticated'
}

export interface ClientState {
  name: ClientStateType;
  enter(client: ConnectedClient): void;
  handle(client: ConnectedClient, data: string): void;
}

export interface ConnectedClient {
  connection: SocketConnection;
  buffer: string;
  state: ClientState;
  stateData: any;
  isTyping: boolean;
  outputBuffer: string[];
  authenticated: boolean;
  user?: UserData;
  adminMonitorSocket?: any;
  isBeingMonitored?: boolean;
  commandHistory?: string[]; // Add command history for up/down arrow navigation
}

export interface SocketConnection {
  getType(): 'telnet' | 'websocket';
  write(data: string): void;
  end(): void;
}

export interface UserData {
  username: string;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  experience: number;
  level: number;
  inCombat: boolean;
  currentRoomId: string;
  inventory: {
    items: string[];
    currency: Currency;
  };
  commandHistory?: string[]; // Add command history to user data for persistence
  currentHistoryIndex?: number; // Add current history index for browsing history
  savedCurrentCommand?: string; // For saving the current command when browsing history
}

export interface Item {
  name: string;
  description?: string;
  type?: string;
  value?: number;
}

export interface Currency {
  gold: number;
  silver: number;
  copper: number;
}

export interface Exit {
  direction: string;
  roomId: string;
  isLocked?: boolean;
  keyId?: string;
}
