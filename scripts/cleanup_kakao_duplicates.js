const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function cleanupKakaoDuplicates() {
    console.log('🔍 Identifying duplicate KAKAO documents...');

    // 1. Get all KAKAO documents
    const { data: allKakaoDocs, error: fetchError } = await supabase
        .from('documents')
        .select('id, url, status, chunk_count, created_at')
        .eq('source_vendor', 'KAKAO');

    if (fetchError) {
        console.error('❌ Error fetching documents:', fetchError);
        return;
    }

    // 2. Group by URL to find duplicates
    const urlGroups = {};
    allKakaoDocs.forEach(doc => {
        if (!urlGroups[doc.url]) {
            urlGroups[doc.url] = [];
        }
        urlGroups[doc.url].push(doc);
    });

    const urlsWithDuplicates = Object.keys(urlGroups).filter(url => urlGroups[url].length > 1);
    console.log(`📊 Found ${urlsWithDuplicates.length} URLs with duplicate entries.`);

    let totalDeleted = 0;
    const idsToDelete = [];

    // 3. Selective deletion logic
    for (const url of urlsWithDuplicates) {
        const group = urlGroups[url];

        // Check if there's at least one "good" version (indexed or processing)
        const hasValidVersion = group.some(d => d.status === 'indexed' || d.status === 'processing');

        // Find all "failed" versions for this specific duplicate URL
        const failedVersions = group.filter(d => d.status === 'failed');

        if (hasValidVersion && failedVersions.length > 0) {
            console.log(`🗑️ URL has active version + ${failedVersions.length} failed versions: ${url}`);
            failedVersions.forEach(d => idsToDelete.push(d.id));
        } else if (failedVersions.length > 1) {
            // If all are failed, keep the most recent one and delete the rest
            console.log(`⚠️ All versions failed for URL, keeping most recent: ${url}`);
            group.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            group.slice(1).forEach(d => idsToDelete.push(d.id));
        }
    }

    if (idsToDelete.length === 0) {
        console.log('✅ No redundant failed duplicates found to delete.');
        return;
    }

    console.log(`🚀 Deleting ${idsToDelete.length} redundant document records...`);

    // 4. Batch delete in chunks to avoid URL length issues or timeouts
    const chunkSize = 50;
    for (let i = 0; i < idsToDelete.length; i += chunkSize) {
        const chunk = idsToDelete.slice(i, i + chunkSize);

        // Delete related records first (if they exist)
        await supabase.from('document_chunks').delete().in('document_id', chunk);

        // Delete the documents
        const { error: deleteError } = await supabase
            .from('documents')
            .delete()
            .in('id', chunk);

        if (deleteError) {
            console.error(`❌ Error deleting chunk starting at ${i}:`, deleteError);
        } else {
            totalDeleted += chunk.length;
            console.log(`✅ Deleted ${totalDeleted}/${idsToDelete.length}`);
        }
    }

    console.log(`\n🏁 Cleanup complete. Total documents removed: ${totalDeleted}`);
}

cleanupKakaoDuplicates();
