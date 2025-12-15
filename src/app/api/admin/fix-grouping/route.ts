import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
                auth: { persistSession: false },
                db: { schema: 'public' }
            }
        );

        // 1. Fetch all URL documents
        const { data: allDocs, error } = await supabase
            .from('documents')
            .select('id, url, title, metadata')
            .eq('type', 'url');

        if (error) throw error;
        if (!allDocs) return NextResponse.json({ success: true, message: 'No documents found' });

        // 2. Build Map of existing URLs
        const urlMap = new Map<string, string>(); // normalized -> realUrl
        allDocs.forEach(doc => {
            if (doc.url) {
                urlMap.set(doc.url.replace(/\/$/, "").trim(), doc.url);
            }
        });

        let updatedCount = 0;
        const updates = [];

        // 3. Scan for orphans and find parents
        for (const doc of allDocs) {
            const metadata = doc.metadata || {};

            // If already has parent, skip (or optionally verify?)
            // Let's assume if it has parentUrl, it's fine. 
            // But user said "grouping failed", so maybe some have NO parentUrl.
            if (metadata.parentUrl) continue;

            const currentNormalized = doc.url.replace(/\/$/, "").trim();
            let bestParent = null;
            let maxLen = 0;

            for (const [dbNormalized, dbRealUrl] of urlMap.entries()) {
                // Parent must be shorter than child and prefix match with slash
                // Avoid matching self
                if (dbNormalized === currentNormalized) continue;

                if (currentNormalized.startsWith(dbNormalized + '/')) {
                    if (dbNormalized.length > maxLen) {
                        maxLen = dbNormalized.length;
                        bestParent = dbRealUrl;
                    }
                }
            }

            if (bestParent) {
                console.log(`🔧 Fixing orphan: ${doc.url} -> Parent: ${bestParent}`);
                updates.push({
                    id: doc.id,
                    metadata: { ...metadata, parentUrl: bestParent, is_sub_page: true }
                });
            }
        }

        // 4. Batch Update (Supabase doesn't support massive bulk update easily in one API call without RPC, 
        //    so we might loop or use upsert if schema allows. 
        //    Upsert requires all columns usually. 
        //    Let's simple loop update for now, or Promise.all in batches.)

        // Using Promise.all with concurrency limit is better
        const BATCH_SIZE = 5;
        for (let i = 0; i < updates.length; i += BATCH_SIZE) {
            const batch = updates.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(update =>
                supabase.from('documents').update({ metadata: update.metadata }).eq('id', update.id)
            ));
            updatedCount += batch.length;
        }

        return NextResponse.json({
            success: true,
            message: `Fixed grouping for ${updatedCount} documents.`,
            updated: updates.map(u => u.id)
        });

    } catch (error) {
        console.error('Error fixing grouping:', error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
