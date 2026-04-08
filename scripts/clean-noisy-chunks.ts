import { createPureClient } from '../src/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

// .env.local 파일 로드 (URL 및 Service Role Key 필요)
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function cleanNoisyChunks() {
    console.log('🚀 RAG 노이즈 청크 정제 스크립트 시작...');

    const supabase = await createPureClient();

    // 1. 노이즈 패턴 정의 (삭제 대상)
    const exactMatchNoise = [
        '어떤', '것을', '받아보세요.', '함께하세요.', '문의하기', '로그인', '회원가입',
        '페이스북', '트위터', '인스타그램', '유튜브', '블로그', '링크드인', '카카오톡', '네이버',
        'X(Twitter)', 'Facebook', 'Instagram', 'YouTube', 'Blog', 'LinkedIn', 'KakaoTalk', 'Naver',
        '문의하기', '회원', '광고주', '비즈니스', '홈', '목록', '전체메뉴', '카테고리', '검색',
        '시작하기', '구독하기', '알아보기', '더보기', '신청하기', '다운로드', '전체보기', '목록보기'
    ];

    const containsNoise = [
        '문의하기회원', '뉴스레터 구독하기', '신규 광고주라면', '무료 체험하기',
        '의견 보내주셔서 감사합니다', '도움이 되었나요', '궁금한 점이 해결되지 않았나요',
        '바로가기 >', '메뉴 펼치기', '메뉴 닫기'
    ];

    console.log(`🔍 대상 확인 중... (전체 텍스트 매칭: ${exactMatchNoise.length}종, 부분 매칭: ${containsNoise.length}종)`);

    let totalDeleted = 0;

    // 2. 정확히 일치하는 단편 노이즈 삭제
    for (const text of exactMatchNoise) {
        const { data, error, count } = await supabase
            .from('document_chunks')
            .delete({ count: 'exact' })
            .eq('content', text);

        if (error) {
            console.error(`❌ '${text}' 삭제 실패:`, error.message);
        } else if (count && count > 0) {
            console.log(`✅ '${text}' 청크 ${count}개 삭제 완료`);
            totalDeleted += count;
        }
    }

    // 3. 10자 이하이며 문장 부호가 없는 짧은 노이즈 삭제 (패턴 기반)
    const shortNoiseShortcuts = ['어떤', '것을', '및', '또는', '등'];
    for (const word of shortNoiseShortcuts) {
        const { count, error } = await supabase
            .from('document_chunks')
            .delete({ count: 'exact' })
            .eq('content', word);

        if (count) totalDeleted += count;
    }

    // 4. 부분 포함 노이즈 삭제
    for (const text of containsNoise) {
        const { data, error, count } = await supabase
            .from('document_chunks')
            .delete({ count: 'exact' })
            .like('content', `%${text}%`);

        if (error) {
            console.error(`❌ '%${text}%' 포함 청크 삭제 실패:`, error.message);
        } else if (count && count > 0) {
            console.log(`✅ '%${text}%' 포함 청크 ${count}개 삭제 완료`);
            totalDeleted += count;
        }
    }

    // 5. 정규식 등을 활용한 추가 정제
    const tinyNoise = await supabase
        .from('document_chunks')
        .select('id, content')
        .lte('content', '     ')
        .limit(1000);

    if (tinyNoise.data) {
        const toDeleteIds = tinyNoise.data
            .filter(item => {
                const c = item.content.trim();
                return c.length > 0 && c.length <= 3 && !/[\d.!?]/.test(c);
            })
            .map(item => item.id);

        if (toDeleteIds.length > 0) {
            const { count, error } = await supabase
                .from('document_chunks')
                .delete({ count: 'exact' })
                .in('id', toDeleteIds);

            if (count) {
                console.log(`✅ 기타 단편 청크(1~3자) ${count}개 삭제 완료`);
                totalDeleted += count;
            }
        }
    }

    console.log(`\n✨ 정제 작업 완료! 총 ${totalDeleted}개의 노이즈 청크가 삭제되었습니다.`);
}

cleanNoisyChunks().catch(err => {
    console.error('💥 스크립트 실행 중 치명적 오류 발생:', err);
    process.exit(1);
});
