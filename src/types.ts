import { IConnection } from './connection/interfaces/connection.interface';

// Define state enum
export enum ClientStateType {
  CONNECTING = 'connecting',
  LOGIN = 'login',
  SIGNUP = 'signup',
  CONFIRMATION = 'confirmation',
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
    [key: string]: any;
  };
  
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
