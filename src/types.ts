import { Socket } from 'net';

// Define state enum
export enum ClientStateType {
  CONNECTING = 'connecting',
  LOGIN = 'login',
  SIGNUP = 'signup',
  AUTHENTICATED = 'authenticated'
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
}

export interface ConnectedClient {
  socket: Socket;
  user: User | null;
  authenticated: boolean;
  buffer: string;
  state: ClientStateType;
  stateData: Record<string, any>; // For storing state-specific data like maskInput flag
  
  // For output buffering
  isTyping: boolean;
  outputBuffer: string[];
}

export type StateHandler = (client: ConnectedClient, input: string) => void;

export interface ClientState {
  name: ClientStateType;
  enter: (client: ConnectedClient) => void;
  handle: StateHandler;
}
