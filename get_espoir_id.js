import { supabase } from './src/supabase-client.js';

async function run() {
  const { data, error } = await supabase
    .from('draw_types')
    .select('id, name')
    .eq('name', 'Espoir')
    .single();

  if (error) {
    console.error('Error fetching Espoir ID:', error);
  } else {
    console.log(`✅ ID for Espoir: ${data.id}`);
  }
}

run();
