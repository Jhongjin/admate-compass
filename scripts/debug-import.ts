
import { RAGProcessor } from '../src/lib/services/RAGProcessor';

async function test() {
    try {
        console.log('Attempting to initialize RAGProcessor...');
        const processor = new RAGProcessor();
        console.log('✅ RAGProcessor initialized successfully');
    } catch (err) {
        console.error('❌ Error during RAGProcessor initialization:');
        console.error(err);
        if (err instanceof Error && err.stack) {
            console.error('Stack trace:');
            console.error(err.stack);
        }
    }
}

test();
