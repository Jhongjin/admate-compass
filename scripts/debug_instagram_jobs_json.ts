import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkJobs() {
    const { data } = await supabase
        .from('processing_jobs')
        .select('*')
        .contains('payload', { vendor: 'INSTAGRAM' })
        .order('created_at', { ascending: false })
        .limit(2);
    console.log(JSON.stringify(data, null, 2));
}

checkJobs();
