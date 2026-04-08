import { createPureClient } from '../supabase/pure';

export class NaverAdsCrawlingService {
  private static BASE_URL = 'https://ads.naver.com/help/faq/';

  /**
   * 네이버 광고 도움말 ID 범위를 스캔하여 유효한 URL을 크롤링 큐에 등록
   * @param startId 시작 ID (기본 1)
   * @param endId 종료 ID (기본 1000)
   * @param batchSize 한 번에 처리할 요청 수 (기본 20)
   */
  async discoverAndEnqueue(
    startId: number = 1,
    endId: number = 1000,
    batchSize: number = 20
  ): Promise<{ discovered: string[]; enqueued: number; errors: number }> {
    console.log(`🔍 [NaverAdsDiscovery] 스캔 시작: ID ${startId} ~ ${endId}`);

    const discoveredUrls: string[] = [];
    let enqueuedCount = 0;
    let errorCount = 0;

    for (let current = startId; current <= endId; current += batchSize) {
      const batchEnd = Math.min(current + batchSize - 1, endId);
      const batchIds = Array.from({ length: batchEnd - current + 1 }, (_, i) => current + i);

      console.log(`📡 [NaverAdsDiscovery] 배치 처리 중: ID ${current} ~ ${batchEnd}`);

      const results = await Promise.all(
        batchIds.map(async (id) => {
          const url = `${NaverAdsCrawlingService.BASE_URL}${id}`;
          try {
            const response = await fetch(url, {
              method: 'HEAD',
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              }
            });

            if (response.ok) {
              return url;
            }
          } catch (error) {
            console.error(`❌ [NaverAdsDiscovery] ID ${id} 체크 실패:`, error);
          }
          return null;
        })
      );

      const validUrls = results.filter((url): url is string => url !== null);

      if (validUrls.length > 0) {
        console.log(`✅ [NaverAdsDiscovery] ${validUrls.length}개 유효 URL 발견:`, validUrls);
        discoveredUrls.push(...validUrls);

        // 크롤링 큐에 등록
        const enqueued = await this.enqueueUrls(validUrls);
        enqueuedCount += enqueued;
      }

      // 서버 부하 방지를 위한 짧은 휴식 (배치 간 1초)
      if (current + batchSize <= endId) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`🏁 [NaverAdsDiscovery] 스캔 완료: 발견 ${discoveredUrls.length}개, 큐 등록 ${enqueuedCount}개`);
    return { discovered: discoveredUrls, enqueued: enqueuedCount, errors: errorCount };
  }

  /**
   * 발견된 URL들을 documents 테이블에 등록하고 processing_jobs 큐에 추가
   */
  private async enqueueUrls(urls: string[]): Promise<number> {
    try {
      const supabase = await createPureClient();
      let totalEnqueued = 0;

      for (const url of urls) {
        // 1. 중복 확인
        const { data: existingDoc } = await supabase
          .from('documents')
          .select('id, status')
          .eq('url', url)
          .maybeSingle();

        let documentId: string;

        if (existingDoc) {
          documentId = existingDoc.id;
          // 이미 인덱싱된 경우 건너뛰기 (또는 필요시 재크롤링)
          if (existingDoc.status === 'indexed') {
            console.log(`ℹ️ [NaverAdsDiscovery] 이미 인덱싱된 URL 건너뜀: ${url}`);
            continue;
          }
        } else {
          // 2. documents 테이블에 신규 등록
          const newDocId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          const { data: newDoc, error: docError } = await supabase
            .from('documents')
            .insert({
              id: newDocId,
              url,
              title: url, // 제목은 크롤링 후 업데이트됨
              type: 'url',
              status: 'pending',
              source_vendor: 'NAVER',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .select('id')
            .single();

          if (docError) {
            console.error(`❌ [NaverAdsDiscovery] 문서 등록 실패 (${url}):`, docError);
            continue;
          }
          documentId = newDoc.id;
        }

        // 3. processing_jobs에 등록
        const { error: jobError } = await supabase
          .from('processing_jobs')
          .insert({
            document_id: documentId,
            job_type: 'CRAWL',
            status: 'queued',
            priority: 5,
            payload: {
              url,
              vendor: 'NAVER',
              options: {
                discoverSubPages: false,
                useCache: true
              },
              source: 'sequential_scan'
            },
            scheduled_at: new Date().toISOString(),
            attempts: 0,
            max_attempts: 3
          });

        if (jobError) {
          console.error(`❌ [NaverAdsDiscovery] 큐 등록 실패 (${url}):`, jobError);
        } else {
          totalEnqueued++;
        }
      }

      return totalEnqueued;
    } catch (error) {
      console.error('❌ [NaverAdsDiscovery] enqueueUrls 예외 발생:', error);
      return 0;
    }
  }
}

export const naverAdsCrawlingService = new NaverAdsCrawlingService();
