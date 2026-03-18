
import { PuppeteerCrawlingService } from './src/lib/services/PuppeteerCrawlingService';

async function diagnose() {
    console.log('--- Environment Diagnosis ---');
    console.log('Platform:', process.platform);
    console.log('VERCEL env:', process.env.VERCEL);
    console.log('--- PuppeteerCrawlingService Test ---');

    const service = new PuppeteerCrawlingService();
    try {
        await service.init();
        console.log('✅ Browser initialized successfully');
    } catch (err: any) {
        console.error('❌ Browser initialization failed');
        console.error('Error message:', err.message);
        console.error('Stack:', err.stack);
    }
}

diagnose();
