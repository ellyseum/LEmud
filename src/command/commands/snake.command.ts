import { ConnectedClient, ClientStateType } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { StateMachine } from '../../state/stateMachine';

export class SnakeCommand implements Command {
  name = 'snake';
  description = 'Play a game of Snake';

  constructor(private stateMachine: StateMachine) {}

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) {
      writeToClient(client, colorize('You must be logged in to play Snake.\r\n', 'red'));
      return;
    }

    // Store current state to return to
    client.stateData.previousState = client.state;
    
    // Notify player that they are entering the Snake game
    writeToClient(client, colorize('Entering Snake game mode...\r\n', 'green'));
    
    // Set the transition flag
    client.stateData.transitionTo = ClientStateType.SNAKE_GAME;

    // Explicitly invoke the state machine to process the transition
    this.stateMachine.handleInput(client, '');
  }
}