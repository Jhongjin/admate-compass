import { SitemapDiscoveryService } from '../src/lib/services/SitemapDiscoveryService';

async function testDiscovery() {
    console.log('Testing Sitemap Fetch to bypass Puppeteer...');
    const service = new SitemapDiscoveryService();
    try {
        const sitemapUrl = 'https://help.instagram.com/sitemap.xml';
        console.log(`Fetching sitemap from ${sitemapUrl}...`);

        // Expose private method for testing, or use discoverSubPages
        // We'll use discoverSubPages but ensure it prioritizes the sitemap
        const urls = await (service as any).parseSitemap(sitemapUrl, 'help.instagram.com', { maxUrls: 1000, maxDepth: 4 });
        console.log(`Found ${urls.length} URLs from XML Sitemap!`);
        if (urls.length > 0) {
            console.log("Top 10:");
            console.log(urls.slice(0, 10).map((u: any) => u.url));
        }
    } catch (e) {
        console.error(e);
    } finally {
        await service.close();
    }
}

testDiscovery().then(() => process.exit(0));

testDiscovery().then(() => process.exit(0));
