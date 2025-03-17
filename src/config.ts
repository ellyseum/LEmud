import dotenv from 'dotenv';
import path from 'path';

// Load .env file
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

export const config = {
  maxPasswordAttempts: parseInt(process.env.MAX_PASSWORD_ATTEMPTS || '3', 10),
  // Add other configuration values here as needed
};
