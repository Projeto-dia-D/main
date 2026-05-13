import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

export const supabase = createClient(
  config.SUPABASE_URL || 'https://placeholder.supabase.co',
  config.SUPABASE_SERVICE_ROLE_SECRET || 'placeholder',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  }
);

export const TABLE_NAME = 'relatorio_bias';
