
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Try loading from .env or .env.local
const envPaths = ['.env', '.env.local', '.env.production'];
envPaths.forEach(p => {
    const fullPath = path.resolve(process.cwd(), p);
    if (fs.existsSync(fullPath)) {
        console.log(`Loading ${p}...`);
        dotenv.config({ path: fullPath });
    }
});

console.log('--- Environment Check ---');
console.log('ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'SET (Length: ' + process.env.ANTHROPIC_API_KEY.length + ')' : 'MISSING');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'SET' : 'MISSING');
console.log('GOOGLE_API_KEY:', process.env.GOOGLE_API_KEY ? 'SET' : 'MISSING');
console.log('NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? 'SET' : 'MISSING');
console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING');
console.log('-------------------------');
