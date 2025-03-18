// ANSI color codes
export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',
  hidden: '\x1b[8m',

  // Regular Colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Bold Colors
  boldBlack: '\x1b[1;30m',
  boldRed: '\x1b[1;31m',
  boldGreen: '\x1b[1;32m',
  boldYellow: '\x1b[1;33m',
  boldBlue: '\x1b[1;34m',
  boldMagenta: '\x1b[1;35m',
  boldCyan: '\x1b[1;36m',
  boldWhite: '\x1b[1;37m',

  // Underline Colors
  underlineBlack: '\x1b[4;30m',
  underlineRed: '\x1b[4;31m',
  underlineGreen: '\x1b[4;32m',
  underlineYellow: '\x1b[4;33m',
  underlineBlue: '\x1b[4;34m',
  underlineMagenta: '\x1b[4;35m',
  underlineCyan: '\x1b[4;36m',
  underlineWhite: '\x1b[4;37m',

  // Background Colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',

  // High Intensity Colors
  brightBlack: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Bold High Intensity Colors
  boldBrightBlack: '\x1b[1;90m',
  boldBrightRed: '\x1b[1;91m',
  boldBrightGreen: '\x1b[1;92m',
  boldBrightYellow: '\x1b[1;93m',
  boldBrightBlue: '\x1b[1;94m',
  boldBrightMagenta: '\x1b[1;95m',
  boldBrightCyan: '\x1b[1;96m',
  boldBrightWhite: '\x1b[1;97m',

  // High Intensity Background Colors
  bgBrightBlack: '\x1b[100m',
  bgBrightRed: '\x1b[101m',
  bgBrightGreen: '\x1b[102m',
  bgBrightYellow: '\x1b[103m',
  bgBrightBlue: '\x1b[104m',
  bgBrightMagenta: '\x1b[105m',
  bgBrightCyan: '\x1b[106m',
  bgBrightWhite: '\x1b[107m',

  clear: '\x1b[2J\x1b[0;0H',
};

export function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}

export function rainbow(text: string): string {
  const colorKeys = ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta'] as const;
  let result = '';
  
  for (let i = 0; i < text.length; i++) {
    const colorKey = colorKeys[i % colorKeys.length];
    result += colorize(text[i], colorKey);
  }
  
  return result;
}
