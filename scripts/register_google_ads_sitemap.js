const http = require('http');

async function fetchSitemapUrls() {
    const sitemapUrl = 'https://support.google.com/google-ads/sitemap?hl=ko';
    console.log(`📡 Fetching sitemap: ${sitemapUrl}`);

    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Ignore strict TLS temporarily for fetch if needed

    try {
        const response = await fetch(sitemapUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const xmlText = await response.text();

        // Extract loc tags
        const urls = [...xmlText.matchAll(/<loc>(.*?)<\/loc>/gi)].map(m => m[1]);

        // Filter /answer/ urls
        const answerUrls = urls.filter(url => url.includes('/answer/'));

        console.log(`📊 Found ${urls.length} total URLs.`);
        console.log(`✅ Filtered ${answerUrls.length} '/answer/' URLs.`);

        return answerUrls;
    } catch (error) {
        console.error('❌ Failed to fetch sitemap:', error);
        return [];
    }
}

async function enqueueJobs(urls) {
    const apiUrl = 'http://127.0.0.1:3000/api/jobs/enqueue';
    const concurrency = 10;
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    console.log(`🚀 Starting enqueue process for ${urls.length} URLs with concurrency ${concurrency}...`);

    for (let i = 0; i < urls.length; i += concurrency) {
        const batch = urls.slice(i, i + concurrency);
        const promises = batch.map(async (url) => {
            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        jobType: 'CRAWL_SEED',
                        priority: 5,
                        payload: {
                            url: url,
                            vendors: ['GOOGLE'],
                            forceCrawl: false,
                            respectRobots: true,
                            deepCrawlTimeout: false
                        }
                    })
                });

                if (response.status === 202) {
                    successCount++;
                } else {
                    failCount++;
                    const errText = await response.text();
                    console.error(`❌ Error queueing ${url}: status ${response.status}, text: ${errText}`);
                }
            } catch (err) {
                failCount++;
                console.error(`❌ Network/fetch Error queueing ${url}:`, err.message);
            }
        });

        await Promise.all(promises);

        // Log progress
        const progress = Math.min(i + concurrency, urls.length);
        console.log(`⏳ Progress: ${progress} / ${urls.length} (Success: ${successCount}, Failed: ${failCount})`);

        // Small delay to prevent overwhelming the local server completely
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\n🎉 Enqueue process completed!`);
    console.log(`📊 Total: ${urls.length} | Queued: ${successCount} | Failed: ${failCount}`);
}

async function main() {
    const urls = await fetchSitemapUrls();
    if (urls.length > 0) {
        await enqueueJobs(urls);
    } else {
        console.log('⚠️ No URLs found to process.');
    }
}

main();
