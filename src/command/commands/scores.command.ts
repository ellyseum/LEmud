import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { UserManager } from '../../user/userManager';

export class ScoresCommand implements Command {
  name = 'scores';
  description = 'Display the Snake game high scores';
  aliases = ['highscores', 'leaderboard'];

  constructor() {}

  execute(client: ConnectedClient, args: string): void {
    // Retrieve the high scores from the UserManager
    const userManager = UserManager.getInstance();
    const highScores = userManager.getSnakeHighScores(10);
    
    if (highScores.length === 0) {
      writeToClient(client, colorize('No high scores recorded yet.\r\n', 'cyan'));
      return;
    }
    
    // Format header
    let output = colorize('=== SNAKE GAME HIGH SCORES ===\r\n', 'bright');
    
    // Calculate the length needed for username column (at least 15 chars)
    const usernameColWidth = Math.max(15, ...highScores.map(score => score.username.length + 2));
    
    // Display table header
    output += colorize(`${'Rank'.padEnd(5)}${'Player'.padEnd(usernameColWidth)}Score\r\n`, 'cyan');
    output += colorize(`${'-'.repeat(5 + usernameColWidth + 10)}\r\n`, 'dim');
    
    // Display high scores
    highScores.forEach((score, index) => {
      const rank = `${index + 1}.`.padEnd(5);
      const player = score.username.padEnd(usernameColWidth);
      const scoreStr = score.score.toString();
      
      // Highlight the current player's score
      if (client.user && score.username === client.user.username) {
        output += colorize(`${rank}${player}${scoreStr}\r\n`, 'brightYellow');
      } else {
        output += `${rank}${player}${scoreStr}\r\n`;
      }
    });
    
    writeToClient(client, output);
  }
}