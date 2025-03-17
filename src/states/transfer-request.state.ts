import { ClientState, ClientStateType, ConnectedClient } from '../types';
import { UserManager } from '../user/userManager';
import { colorize } from '../utils/colors';
import { writeToClient } from '../utils/socketWriter';
import { formatUsername } from '../utils/formatters';

export class TransferRequestState implements ClientState {
  name = ClientStateType.TRANSFER_REQUEST;
  
  constructor(private userManager: UserManager) {}

  enter(client: ConnectedClient): void {
    if (!client.user) return;
    
    // Store the state to return to if denied
    client.stateData.returnToState = client.stateData.interruptedBy 
      ? client.state 
      : ClientStateType.AUTHENTICATED;
    
    // Get info about the requesting client
    const transferClientId = client.stateData.transferClient?.connection.getId() || 'unknown';
    const clientType = transferClientId.startsWith('ws:') ? 'web browser' : 'telnet client';
    const ipDetails = transferClientId.split(':').slice(1).join(':');
    
    // Notify user about the transfer request
    writeToClient(client, colorize('\r\n\r\n=== SESSION TRANSFER REQUEST ===\r\n', 'bright'));
    writeToClient(client, colorize(`Someone is trying to log in as ${formatUsername(client.user.username)} from a ${clientType}.\r\n`, 'yellow'));
    writeToClient(client, colorize(`Connection details: ${ipDetails}\r\n`, 'dim'));
    writeToClient(client, colorize('Allow this connection to take over your session? (y/n): ', 'cyan'));
  }

  handle(client: ConnectedClient, input: string): void {
    if (!client.user) return;
    
    const response = input.toLowerCase();
    
    if (response === 'y' || response === 'yes') {
      // Approve transfer
      this.userManager.resolveSessionTransfer(client.user.username, true);
    } else {
      // Deny transfer
      this.userManager.resolveSessionTransfer(client.user.username, false);
    }
  }
}
