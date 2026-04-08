const url = 'https://kakaobusiness.gitbook.io/main/ad/info';
const apiUrl = 'http://127.0.0.1:3000/api/jobs/enqueue';

async function testSingle() {
    console.log(`🚀 Testing single enqueue for: ${url}`);
    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                jobType: 'CRAWL_SEED',
                priority: 15, // High priority
                payload: {
                    url: url,
                    vendors: ['KAKAO'],
                    forceCrawl: false,
                    respectRobots: true,
                    deepCrawlTimeout: false
                }
            })
        });

        console.log(`📡 Response status: ${response.status}`);
        const text = await response.text();
        console.log(`📄 Response body: ${text}`);
    } catch (err) {
        console.error(`❌ Fetch error:`, err.message);
    }
}

testSingle();
