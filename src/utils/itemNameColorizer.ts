import { colorize, ColorType } from './colors';

/**
 * Color mapping for item name color codes
 */
const COLOR_MAP: {[key: string]: string} = {
  'k': 'black',
  'r': 'red',
  'g': 'green',
  'y': 'yellow',
  'b': 'blue',
  'm': 'magenta',
  'c': 'cyan',
  'w': 'white',
  'a': 'gray',
  'K': 'brightblack',
  'R': 'brightred',
  'G': 'brightgreen',
  'Y': 'brightyellow',
  'B': 'brightblue',
  'M': 'brightmagenta',
  'C': 'brightcyan',
  'W': 'brightwhite',
  'A': 'brightgray'
};

/**
 * Processes a name with color codes and returns a colorized string
 * Supports multiple color codes anywhere in the string
 * 
 * @param name The name with color codes (e.g., "Iron $rSword of $bFrost")
 * @param defaultColor The color to use for text without a specific color code
 * @returns A string with ANSI color codes applied
 */
export function colorizeItemName(name: string, defaultColor: ColorType = 'white'): string {
  if (!name) return '';

  // Regular expression to find all color codes in the string
  const colorCodeRegex = /\$([krgybmcwaKRGYBMCWA])/g;
  
  // Replace each color code with a special marker that includes the color code
  // This preserves the original structure including spaces
  let processedName = name;
  let currentColor: ColorType = defaultColor;
  let result = '';
  
  // Find all color code positions and their matching colors
  const matches: {index: number; color: ColorType}[] = [];
  let match;
  while ((match = colorCodeRegex.exec(name)) !== null) {
    if (COLOR_MAP[match[1]]) {
      matches.push({
        index: match.index,
        color: COLOR_MAP[match[1]] as ColorType
      });
    }
  }
  
  // If no color codes, just return the name in default color
  if (matches.length === 0) {
    return colorize(name, defaultColor);
  }
  
  // Process the string in segments
  let lastIndex = 0;
  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    
    // Add any text before this color code with the current color
    if (currentMatch.index > lastIndex) {
      const textBefore = name.substring(lastIndex, currentMatch.index);
      result += colorize(textBefore, currentColor);
    }
    
    // Update the current color
    currentColor = currentMatch.color;
    
    // Update lastIndex to skip the color code
    lastIndex = currentMatch.index + 2; // +2 to skip '$' and the color letter
    
    // If this is the last color code, add all remaining text
    if (i === matches.length - 1) {
      const remainingText = name.substring(lastIndex);
      result += colorize(remainingText, currentColor);
    }
  }

  return result;
}

/**
 * Removes color codes from a name, leaving only the plain text
 * 
 * @param name The name with color codes
 * @returns The name without color codes
 */
export function stripColorCodes(name: string): string {
  if (!name) return '';
  return name.replace(/\$[krgybmcwaKRGYBMCWA]/g, '');
}