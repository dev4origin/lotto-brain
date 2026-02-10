import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config({ path: join(__dirname, '..', '.env.local') });

export const CONFIG = {
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY
  },
  lotto: {
    apiUrl: process.env.LOTTO_API_URL || 'https://lotobonheur.ci/api/results'
  }
};

// Validate configuration
if (!CONFIG.supabase.url || !CONFIG.supabase.key) {
  throw new Error('Missing Supabase configuration. Please check your .env.local file.');
}

export default CONFIG;
