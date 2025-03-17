import { ConnectedClient } from '../types';

export interface Command {
  name: string;
  description: string;
  execute(client: ConnectedClient, args: string): void;
}
