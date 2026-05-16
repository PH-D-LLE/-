import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Lazy initialization to avoid errors if env vars are missing
export const getSupabase = () => {
  let url = supabaseUrl;
  if (url && url.includes('supabase.co')) {
    // If user copied 'https://xyz.supabase.co/rest/v1/', clean it to just the base URL
    url = url.split('/rest/v1')[0].replace(/\/$/, '');
  }

  if (
    !url || 
    !supabaseAnonKey || 
    url === 'YOUR_SUPABASE_URL' ||
    url.includes('(사용자분의') || 
    !url.startsWith('http') ||
    url.endsWith('supabase.com') ||
    url.endsWith('supabase.com/') ||
    url.includes('supabase.com/dashboard')
  ) {
    if (url && (url.endsWith('supabase.com') || url.endsWith('supabase.com/') || url.includes('supabase.com/dashboard'))) {
      console.warn("Supabase URL error: You used the Supabase dashboard URL. Please use the 'API URL' from Settings -> API (e.g., https://xxx.supabase.co)");
    }
    return null;
  }
  try {
    return createClient(url, supabaseAnonKey);
  } catch (err) {
    console.error('Supabase client creation failed:', err);
    return null;
  }
};
