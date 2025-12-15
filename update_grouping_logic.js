
const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, 'src', 'app', 'admin', 'docs', 'page.tsx');

const oldLogic = `    const documentGroups = useMemo(() => {
        if (activeTab !== "crawling") return [];

        const groups: any[] = [];
        const domainMap = new Map<string, any>();

        filteredDocs.forEach((doc: Document) => {
            let domain = 'Unknown';
            try {
                if (doc.url) {
                    domain = new URL(doc.url).hostname;
                }
            } catch (e) { }

            const groupedDoc = {
                ...doc,
                url: doc.url || '',
                updated_at: doc.updated_at || doc.created_at,
                isMainUrl: false
            };

            if (!domainMap.has(domain)) {
                domainMap.set(domain, {
                    domain,
                    mainUrl: doc.url || '',
                    mainDocument: { ...groupedDoc, isMainUrl: true },
                    subPages: [],
                    totalChunks: doc.chunk_count || 0,
                    isExpanded: false,
                    selectedSubPages: []
                });
                groups.push(domainMap.get(domain));
            } else {
                const group = domainMap.get(domain);
                group.subPages.push({ ...groupedDoc, isMainUrl: false });
                group.totalChunks += (doc.chunk_count || 0);
            }
        });

        return groups.map((group, index) => ({
            ...group,
            isExpanded: expandedGroups.has(index)
        }));
    }, [filteredDocs, activeTab, expandedGroups]);`;

const newLogic = `    const documentGroups = useMemo(() => {
        if (activeTab !== "crawling") return [];

        const groupMap = new Map<string, any>();

        filteredDocs.forEach((doc: Document) => {
            const metadata = doc.metadata || {};
            const parentUrl = metadata.parentUrl || null;
            const isSubPage = !!parentUrl;
            
            // 그룹 키 결정: 하위 페이지면 부모 URL, 아니면(메인 페이지) 본인 URL
            const groupKey = parentUrl || doc.url;
            
            if (!groupKey) return;

            if (!groupMap.has(groupKey)) {
                let domain = 'Unknown';
                try {
                    if (groupKey) {
                        domain = new URL(groupKey).hostname;
                    }
                } catch (e) { }

                groupMap.set(groupKey, {
                    domain,
                    mainUrl: groupKey,
                    mainDocument: null,
                    subPages: [],
                    totalChunks: 0,
                    isExpanded: false,
                    selectedSubPages: []
                });
            }

            const group = groupMap.get(groupKey);
            
            const groupedDoc = {
                ...doc,
                url: doc.url || '',
                updated_at: doc.updated_at || doc.created_at,
                isMainUrl: !isSubPage
            };

            if (isSubPage) {
                group.subPages.push(groupedDoc);
            } else {
                group.mainDocument = groupedDoc;
            }
            
            group.totalChunks += (doc.chunk_count || 0);
        });

        const resultGroups: any[] = [];
        groupMap.forEach((group) => {
            if (!group.mainDocument && group.subPages.length > 0) {
                 const firstSub = group.subPages[0];
                 group.mainDocument = { ...firstSub, title: \`[원본 없음] \${firstSub.title}\` };
                 group.subPages = group.subPages.slice(1);
            }

            if (group.mainDocument) {
                resultGroups.push(group);
            }
        });

        return resultGroups.map((group, index) => ({
            ...group,
            isExpanded: expandedGroups.has(index)
        }));
    }, [filteredDocs, activeTab, expandedGroups]);`;

try {
    let content = fs.readFileSync(targetFile, 'utf8');

    // Normalize newlines to avoid mismatch issues
    const normalize = (str) => str.replace(/\r\n/g, '\n').trim();

    // We try to find the block by a simpler logic if exact match fails
    // But let's try exact match first (after normalization)

    // Check if new logic is already there
    if (content.includes('const parentUrl = metadata.parentUrl')) {
        console.log('New logic already present.');
        return;
    }

    // Direct string replacement
    // Since whitespace might differ, we might need a more robust way.
    // Let's try to locate the start and end of the useMemo block manually if simple replace fails.

    if (content.indexOf(oldLogic) === -1) {
        console.log('Exact string match failed. Trying to locate range...');
        // Fallback: Locate start and end
        const startMarker = 'const documentGroups = useMemo(() => {';
        const endMarker = '}, [filteredDocs, activeTab, expandedGroups]);';

        const startIdx = content.indexOf(startMarker);
        const endIdx = content.indexOf(endMarker, startIdx);

        if (startIdx !== -1 && endIdx !== -1) {
            const toReplace = content.substring(startIdx, endIdx + endMarker.length);
            console.log('Found block by markers. Replacing...');
            content = content.replace(toReplace, newLogic);
            fs.writeFileSync(targetFile, content, 'utf8');
            console.log('Successfully updated page.tsx');
        } else {
            console.error('Could not find code block to replace.');
            process.exit(1);
        }
    } else {
        const newContent = content.replace(oldLogic, newLogic);
        fs.writeFileSync(targetFile, newContent, 'utf8');
        console.log('Successfully updated page.tsx with exact match.');
    }

} catch (e) {
    console.error('Error:', e);
}
