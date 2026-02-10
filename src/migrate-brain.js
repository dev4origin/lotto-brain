import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from './supabase-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

async function migrate() {
  console.log('🧠 Starting Brain Memory Migration to Supabase...');
  
  // 1. Migrate Main Brain
  const brainFile = path.join(DATA_DIR, 'brain.json');
  if (fs.existsSync(brainFile)) {
    console.log('   Reading local brain.json...');
    try {
      const data = JSON.parse(fs.readFileSync(brainFile, 'utf8'));
      
      console.log('   Uploading to Supabase (id=winning)...');
      const { error } = await supabase
        .from('ai_memory')
        .upsert({ 
          id: 'winning', 
          data: data,
          updated_at: new Date()
        });
        
      if (error) throw error;
      console.log('   ✅ Main Brain migrated successfully!');
    } catch (e) {
      console.error('   ❌ Error migrating Main Brain:', e.message);
    }
  } else {
    console.log('   ⚠️ No local brain.json found. Skipping.');
  }
  
  // 2. Migrate Machine Brain
  const machineFile = path.join(DATA_DIR, 'machine_brain.json');
  if (fs.existsSync(machineFile)) {
    console.log('   Reading local machine_brain.json...');
    try {
      const data = JSON.parse(fs.readFileSync(machineFile, 'utf8'));
      
      console.log('   Uploading to Supabase (id=machine)...');
      const { error } = await supabase
        .from('ai_memory')
        .upsert({ 
          id: 'machine', 
          data: data,
          updated_at: new Date()
        });
        
      if (error) throw error;
      console.log('   ✅ Machine Brain migrated successfully!');
    } catch (e) {
      console.error('   ❌ Error migrating Machine Brain:', e.message);
    }
  } else {
    console.log('   ℹ️ No local machine_brain.json found.');
  }
  
  console.log('✨ Migration Complete!');
}

migrate();
