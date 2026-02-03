'use client';

export interface GroupedDocument {
  id: string;
  title: string;
  url: string;
  type: string;
  status: string;
  chunk_count: number;
  created_at: string;
  updated_at: string;
  isMainUrl: boolean;
  mainDocumentId?: string; // main_document_id 필드 추가
  parentUrl?: string;
  discoveredUrls?: Array<{
    url: string;
    title?: string;
    source: 'sitemap' | 'robots' | 'links' | 'pattern';
    depth: number;
  }>;
}

export interface DocumentGroup {
  domain: string;
  mainUrl: string;
  mainDocument: GroupedDocument;
  subPages: GroupedDocument[];
  totalChunks: number;
  isExpanded: boolean;
  selectedSubPages: string[];
}

export class DocumentGroupingService {
  /**
   * URL에서 도메인 추출
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (error) {
      return '기타';
    }
  }

  /**
   * URL이 메인 URL인지 확인 (가장 짧은 경로를 가진 URL)
   */
  private isMainUrl(url: string, allUrls: string[]): boolean {
    const domain = this.extractDomain(url);
    const sameDomainUrls = allUrls.filter(u => this.extractDomain(u) === domain);
    
    if (sameDomainUrls.length === 1) return true;
    
    // 가장 짧은 경로를 가진 URL이 메인 URL
    const sortedUrls = sameDomainUrls.sort((a, b) => {
      try {
        const pathA = new URL(a).pathname;
        const pathB = new URL(b).pathname;
        return pathA.length - pathB.length;
      } catch {
        return a.length - b.length;
      }
    });
    
    return sortedUrls[0] === url;
  }

  /**
   * URL이 다른 URL의 하위 페이지인지 확인
   */
  private isSubPage(url: string, mainUrl: string): boolean {
    if (url === mainUrl) return false;
    
    try {
      const urlObj = new URL(url);
      const mainUrlObj = new URL(mainUrl);
      
      // 같은 도메인이어야 함
      if (urlObj.hostname !== mainUrlObj.hostname) return false;
      
      // 메인 URL의 경로가 하위 URL의 경로에 포함되어야 함
      return urlObj.pathname.startsWith(mainUrlObj.pathname);
    } catch {
      return false;
    }
  }

  /**
   * 문서들을 도메인별로 그룹화
   * main_document_id를 우선 사용하고, 없으면 URL 패턴으로 그룹화
   */
  groupDocumentsByDomain(documents: GroupedDocument[]): DocumentGroup[] {
    // null 또는 undefined 체크
    if (!documents || !Array.isArray(documents)) {
      console.warn('⚠️ DocumentGroupingService: documents가 null이거나 배열이 아닙니다:', documents);
      return [];
    }
    
    const urlDocuments = documents.filter(doc => doc.type === 'url');
    const groups: { [key: string]: DocumentGroup } = {};
    const mainDocumentMap = new Map<string, GroupedDocument>(); // main_document_id -> main document
    const subDocumentsByMainId = new Map<string, GroupedDocument[]>(); // main_document_id -> sub documents

    // 디버깅: mainDocumentId 통계
    const docsWithMainId = urlDocuments.filter(doc => doc.mainDocumentId !== undefined && doc.mainDocumentId !== null);
    const docsWithoutMainId = urlDocuments.filter(doc => !doc.mainDocumentId || doc.mainDocumentId === null || doc.mainDocumentId === undefined);
    console.log(`[CRITICAL] 📊 DocumentGroupingService 그룹화 시작:`, {
      totalDocuments: urlDocuments.length,
      docsWithMainId: docsWithMainId.length,
      docsWithoutMainId: docsWithoutMainId.length,
      sampleWithMainId: docsWithMainId.slice(0, 3).map(d => ({ id: d.id, title: d.title?.substring(0, 30), mainDocumentId: d.mainDocumentId }))
    });

    // 1. main_document_id 기반 그룹화 (우선순위)
    // 먼저 모든 문서를 순회하여 메인 문서와 하위 문서를 분류
    urlDocuments.forEach(doc => {
      // mainDocumentId가 명시적으로 설정되어 있는 경우 (null이 아닌 경우)
      if (doc.mainDocumentId !== undefined && doc.mainDocumentId !== null) {
        // 하위 문서 (main_document_id가 있음)
        if (!subDocumentsByMainId.has(doc.mainDocumentId)) {
          subDocumentsByMainId.set(doc.mainDocumentId, []);
        }
        subDocumentsByMainId.get(doc.mainDocumentId)!.push(doc);
      } else {
        // 메인 문서 (main_document_id가 없음)
        mainDocumentMap.set(doc.id, doc);
      }
    });

    console.log(`[CRITICAL] 📊 그룹화 분류 완료:`, {
      mainDocuments: mainDocumentMap.size,
      subDocumentsByMainId: Array.from(subDocumentsByMainId.entries()).map(([id, docs]) => ({ mainId: id, subCount: docs.length }))
    });

    // 2. main_document_id 기반 그룹 생성
    mainDocumentMap.forEach((mainDoc, mainDocId) => {
      const subDocs = subDocumentsByMainId.get(mainDocId) || [];
      const domain = this.extractDomain(mainDoc.url || '');
      const groupKey = `main_${mainDocId}`;
      
      groups[groupKey] = {
        domain,
        mainUrl: mainDoc.url || '',
        mainDocument: mainDoc,
        subPages: subDocs,
        totalChunks: mainDoc.chunk_count + subDocs.reduce((sum, sub) => sum + sub.chunk_count, 0),
        isExpanded: false,
        selectedSubPages: []
      };
    });

    // 2-1. main_document_id가 있지만 메인 문서를 찾을 수 없는 경우 처리
    // (메인 문서가 아직 로드되지 않았거나 필터링된 경우)
    subDocumentsByMainId.forEach((subDocs, mainDocId) => {
      if (!mainDocumentMap.has(mainDocId)) {
        // 메인 문서를 찾을 수 없으면 첫 번째 하위 문서를 메인으로 사용
        const firstSubDoc = subDocs[0];
        if (firstSubDoc) {
          const domain = this.extractDomain(firstSubDoc.url || '');
          const groupKey = `main_${mainDocId}`;
          
          // 이미 그룹이 있으면 하위 문서만 추가
          if (groups[groupKey]) {
            groups[groupKey].subPages.push(...subDocs);
            groups[groupKey].totalChunks += subDocs.reduce((sum, sub) => sum + sub.chunk_count, 0);
          } else {
            // 그룹이 없으면 첫 번째 하위 문서를 메인으로 사용
            groups[groupKey] = {
              domain,
              mainUrl: firstSubDoc.url || '',
              mainDocument: firstSubDoc,
              subPages: subDocs.slice(1), // 첫 번째는 메인으로 사용
              totalChunks: firstSubDoc.chunk_count + subDocs.slice(1).reduce((sum, sub) => sum + sub.chunk_count, 0),
              isExpanded: false,
              selectedSubPages: []
            };
          }
        }
      }
    });

    // 3. main_document_id가 없는 문서들을 URL 패턴으로 그룹화 (fallback)
    const ungroupedDocs = urlDocuments.filter(doc => {
      // main_document_id가 없고, 이미 그룹에 포함되지 않은 문서
      return !doc.mainDocumentId && !mainDocumentMap.has(doc.id);
    });

    ungroupedDocs.forEach(doc => {
      if (!doc.url) {
        console.warn('⚠️ DocumentGroupingService: doc.url이 없습니다:', doc);
        return;
      }
      
      const domain = this.extractDomain(doc.url);
      const allUrls = ungroupedDocs.map(d => d.url).filter(url => url);
      
      if (this.isMainUrl(doc.url, allUrls)) {
        const groupKey = `url_${domain}`;
        if (!groups[groupKey]) {
          groups[groupKey] = {
            domain,
            mainUrl: doc.url,
            mainDocument: doc,
            subPages: [],
            totalChunks: 0,
            isExpanded: false,
            selectedSubPages: []
          };
        }
      }
    });

    // 4. URL 패턴 기반 하위 페이지 할당 (fallback)
    ungroupedDocs.forEach(doc => {
      if (!doc.url) {
        console.warn('⚠️ DocumentGroupingService: doc.url이 없습니다 (하위 페이지):', doc);
        return;
      }
      
      const domain = this.extractDomain(doc.url);
      const groupKey = `url_${domain}`;
      const group = groups[groupKey];
      
      if (group && doc.url !== group.mainUrl) {
        if (this.isSubPage(doc.url, group.mainUrl)) {
          group.subPages.push(doc);
        } else {
          // 하위 페이지가 아닌 경우 별도 그룹으로 처리
          const subDomain = `${domain}_${doc.url}`;
          const subGroupKey = `url_${subDomain}`;
          if (!groups[subGroupKey]) {
            groups[subGroupKey] = {
              domain: subDomain,
              mainUrl: doc.url,
              mainDocument: doc,
              subPages: [],
              totalChunks: 0,
              isExpanded: false,
              selectedSubPages: []
            };
          }
        }
      }
    });

    // 5. 총 청크 수 계산 (URL 패턴 그룹)
    Object.values(groups).forEach(group => {
      if (group.totalChunks === 0) {
        group.totalChunks = group.mainDocument.chunk_count + 
          group.subPages.reduce((sum, sub) => sum + sub.chunk_count, 0);
      }
    });

    return Object.values(groups).sort((a, b) => a.domain.localeCompare(b.domain));
  }

  /**
   * 그룹의 하위 페이지 선택 상태 토글
   */
  toggleSubPageSelection(
    groups: DocumentGroup[], 
    groupIndex: number, 
    subPageUrl: string
  ): DocumentGroup[] {
    return groups.map((group, index) => {
      if (index === groupIndex) {
        const isSelected = group.selectedSubPages.includes(subPageUrl);
        return {
          ...group,
          selectedSubPages: isSelected
            ? group.selectedSubPages.filter(url => url !== subPageUrl)
            : [...group.selectedSubPages, subPageUrl]
        };
      }
      return group;
    });
  }

  /**
   * 그룹의 모든 하위 페이지 선택/해제
   */
  toggleAllSubPages(
    groups: DocumentGroup[], 
    groupIndex: number
  ): DocumentGroup[] {
    return groups.map((group, index) => {
      if (index === groupIndex) {
        const allSelected = group.subPages.every(sub => 
          group.selectedSubPages.includes(sub.url)
        );
        
        return {
          ...group,
          selectedSubPages: allSelected 
            ? [] 
            : group.subPages.map(sub => sub.url)
        };
      }
      return group;
    });
  }

  /**
   * 그룹 확장/축소 토글
   */
  toggleGroupExpansion(
    groups: DocumentGroup[], 
    groupIndex: number
  ): DocumentGroup[] {
    return groups.map((group, index) => {
      if (index === groupIndex) {
        return {
          ...group,
          isExpanded: !group.isExpanded
        };
      }
      return group;
    });
  }

  /**
   * 선택된 하위 페이지들만 필터링
   */
  getSelectedSubPages(groups: DocumentGroup[]): GroupedDocument[] {
    const selected: GroupedDocument[] = [];
    
    groups.forEach(group => {
      selected.push(group.mainDocument);
      group.subPages.forEach(subPage => {
        if (group.selectedSubPages.includes(subPage.url)) {
          selected.push(subPage);
        }
      });
    });
    
    return selected;
  }
}

// 싱글톤 인스턴스
export const documentGroupingService = new DocumentGroupingService();


