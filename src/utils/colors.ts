// Export color codes for ANSI terminal coloring
export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',
  hidden: '\x1b[8m',
  
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',        // Added gray (using bright black)
  brightgray: '\x1b[37m',  // Added brightgray (using white)
  
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
  
  // Bold colors
  boldBlack: '\x1b[1m\x1b[30m',
  boldRed: '\x1b[1m\x1b[31m',
  boldGreen: '\x1b[1m\x1b[32m',
  boldYellow: '\x1b[1m\x1b[33m',
  boldBlue: '\x1b[1m\x1b[34m',
  boldMagenta: '\x1b[1m\x1b[35m',
  boldCyan: '\x1b[1m\x1b[36m',
  boldWhite: '\x1b[1m\x1b[37m',
  
  // Bright colors (some terminals interpret these as bold)
  brightBlack: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
  
  // Bright background colors
  bgBrightBlack: '\x1b[100m',
  bgBrightRed: '\x1b[101m',
  bgBrightGreen: '\x1b[102m',
  bgBrightYellow: '\x1b[103m',
  bgBrightBlue: '\x1b[104m',
  bgBrightMagenta: '\x1b[105m',
  bgBrightCyan: '\x1b[106m',
  bgBrightWhite: '\x1b[107m',
  
  // Special codes
  clear: '\x1B[2J\x1B[0f'  // Clear the entire screen and move cursor to 0,0
};

// Define the color type to explicitly export it
export type ColorType = 'blink' | 'reset' | 'bright' | 'dim' | 'underscore' | 'reverse' | 'hidden' |
                'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' |
                'boldBlack' | 'boldRed' | 'boldGreen' | 'boldYellow' | 'boldBlue' |
                'boldMagenta' | 'boldCyan' | 'boldWhite' | 'clear' | 'gray' | 'brightgray' |
                'brightBlack' | 'brightRed' | 'brightGreen' | 'brightYellow' |
                'brightBlue' | 'brightMagenta' | 'brightCyan' | 'brightWhite' |
                'bgBlack' | 'bgRed' | 'bgGreen' | 'bgYellow' | 'bgBlue' | 'bgMagenta' |
                'bgCyan' | 'bgWhite' | 'bgBrightBlack' | 'bgBrightRed' | 'bgBrightGreen' |
                'bgBrightYellow' | 'bgBrightBlue' | 'bgBrightMagenta' | 'bgBrightCyan' | 'bgBrightWhite';

/**
 * Apply ANSI color codes to a string
 * @param text The text to colorize
 * @param color The color to apply
 * @returns The colorized text
 */
export function colorize(text: string, color: ColorType): string {
  const colorCode = colors[color] || '';
  return `${colorCode}${text}${colors.reset}`;
}

/**
 * Remove all ANSI color codes from a string
 * @param text The text to strip color codes from
 * @returns The text without any color codes
 */
export function stripColorCodes(text: string): string {
  // This regex matches all ANSI escape codes
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Remove all custom color codes ($code format) from a string
 * @param text The text to strip custom color codes from
 * @returns The text without any custom color codes
 */
export function stripCustomColorCodes(text: string): string {
  // This regex matches all custom color codes in the format $x where x is any single character
  return text.replace(/\$[a-zA-Z0-9]/g, '');
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
