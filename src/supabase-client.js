import { createClient } from '@supabase/supabase-js';
import CONFIG from './config.js';

export const supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.key);

export default supabase;
