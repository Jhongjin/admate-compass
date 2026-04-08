const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDuplicates() {
    const url = 'https://kakaobusiness.gitbook.io/main/ad/info';
    console.log('Checking for documents with URL:', url);

    const { data, error } = await supabase
        .from('documents')
        .select('id, title, status, chunk_count')
        .eq('url', url);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('Found:', data.length, 'documents');
    console.log(JSON.stringify(data, null, 2));
}

checkDuplicates();
