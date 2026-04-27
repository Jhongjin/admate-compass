import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const urls = [
    "https://help.instagram.com/110121795815331/",
    "https://help.instagram.com/479832029758079/",
    "https://help.instagram.com/2335700983566418/",
    "https://help.instagram.com/1417489251945243/",
    "https://help.instagram.com/345310197245685/",
    "https://help.instagram.com/374546259294234/",
    "https://help.instagram.com/368191326593075/",
    "https://help.instagram.com/615080698917740/",
    "https://help.instagram.com/165828726894770/",
    "https://help.instagram.com/369001149843369/",
    "https://help.instagram.com/117838865078314/",
    "https://help.instagram.com/4384327961801351/",
    "https://help.instagram.com/442837725762581/",
    "https://help.instagram.com/1211497864294787/",
    "https://help.instagram.com/566810106808145/",
    "https://help.instagram.com/797430869922966/",
    "https://help.instagram.com/604924674595356/",
    "https://help.instagram.com/617647220806809/",
    "https://help.instagram.com/771937875904854/",
    "https://help.instagram.com/945221763907783/",
    "https://help.instagram.com/198632106142837/",
    "https://help.instagram.com/642621087708941/",
    "https://help.instagram.com/1582474155197965/",
    "https://help.instagram.com/670309656726033/",
    "https://help.instagram.com/398421583263270/",
    "https://help.instagram.com/1124604297705184/",
    "https://help.instagram.com/1372599552763476/",
    "https://help.instagram.com/766857281395358/",
    "https://help.instagram.com/936296650678728/",
    "https://help.instagram.com/1982960765199109/",
    "https://help.instagram.com/377830165708421/",
    "https://help.instagram.com/122717417885747/",
    "https://help.instagram.com/1316037595447792/",
    "https://help.instagram.com/265220288098142/",
    "https://help.instagram.com/308605337351503/",
    "https://help.instagram.com/3490194014566528/",
    "https://help.instagram.com/337513185037576/",
    "https://help.instagram.com/1627591223954487/",
    "https://help.instagram.com/426700567389543/",
    "https://help.instagram.com/219914557612468/",
    "https://help.instagram.com/2419286908233223/",
    "https://help.instagram.com/269765046710559/",
    "https://help.instagram.com/795416058241092/",
    "https://help.instagram.com/151636988358045/",
    "https://help.instagram.com/442418472487929/",
    "https://help.instagram.com/2720958398006062/",
    "https://help.instagram.com/408972995943225/",
    "https://help.instagram.com/453965678013216/",
    "https://help.instagram.com/448523408565555/",
    "https://help.instagram.com/627963287377328/",
    "https://help.instagram.com/728994388226960/",
    "https://help.instagram.com/362497417173378/",
    "https://help.instagram.com/583107688369069/",
    "https://help.instagram.com/557544397610546/",
    "https://help.instagram.com/438970006178813/",
    "https://help.instagram.com/492762895616247/",
    "https://help.instagram.com/2027685808023874/",
    "https://help.instagram.com/1335402328251028/",
    "https://help.instagram.com/1164282428364072/",
    "https://help.instagram.com/781564098047290/",
    "https://help.instagram.com/1980623166138346/",
    "https://help.instagram.com/936461478584269/",
    "https://help.instagram.com/1660923094227526/",
    "https://help.instagram.com/272122157758915/",
    "https://help.instagram.com/194353285783006/",
    "https://help.instagram.com/357872324807367/"
];

async function run() {
    console.log(`Starting to enqueue ${urls.length} Instagram Help pages for crawling...`);
    let successCount = 0;

    for (const url of urls) {
        const { data, error } = await supabase
            .from('processing_jobs')
            .insert({
                job_type: 'CRAWL_SEED',
                payload: {
                    vendor: 'INSTAGRAM',
                    url: url,
                    extractSubPages: false, // Set to false since we directly have the exact articles now
                    maxDepth: 1,
                    domainLimit: true
                },
                status: 'queued'
            });

        if (error) {
            console.error(`❌ Failed to enqueue ${url}:`, error.message);
        } else {
            successCount++;
        }
    }

    console.log(`✅ Completed: Successfully queued ${successCount}/${urls.length} jobs.`);
}

run();
