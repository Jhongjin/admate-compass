import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
  }
);

interface VendorUpdateInfo {
  vendor: string;
  documentCount: number;
  lastUpdateDate: string | null;
  formattedDate: string;
  message: string;
}

export async function GET(request: NextRequest) {
  try {
    console.log('🚀 벤더별 업데이트 정보 조회 시작...');

    const vendors = ['META', 'NAVER', 'KAKAO', 'GOOGLE', 'X(TWITTER)', 'OTHER'];
    const vendorUpdates: VendorUpdateInfo[] = [];

    for (const vendor of vendors) {
      // 각 벤더별 문서 수 및 최신 업데이트 일자 조회
      const { data: documents, error } = await supabase
        .from('documents')
        .select('id, updated_at, status')
        .eq('source_vendor', vendor)
        .eq('status', 'indexed')
        .order('updated_at', { ascending: false })
        .limit(1);

      if (error) {
        console.error(`❌ ${vendor} 문서 조회 오류:`, error);
        continue;
      }

      const documentCount = await supabase
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('source_vendor', vendor)
        .eq('status', 'indexed');

      const count = documentCount.count || 0;
      const lastUpdate = documents?.[0]?.updated_at || null;

      let formattedDate = '업데이트 없음';
      if (lastUpdate) {
        const updateDate = new Date(lastUpdate);
        formattedDate = updateDate.toLocaleDateString('ko-KR', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      }

      // 벤더 이름 한글 변환
      const vendorNames: Record<string, string> = {
        'META': 'Meta',
        'NAVER': 'Naver',
        'KAKAO': 'Kakao',
        'GOOGLE': 'Google',
        'X(TWITTER)': 'X',
        'OTHER': '기타',
      };

      const vendorName = vendorNames[vendor] || vendor;
      const message = lastUpdate
        ? `${vendorName} 광고 정책 가이드 ${count}개 문서 ${formattedDate} 업데이트`
        : `${vendorName} 광고 정책 가이드 ${count}개 문서`;

      vendorUpdates.push({
        vendor: vendorName,
        documentCount: count,
        lastUpdateDate: lastUpdate,
        formattedDate,
        message,
      });
    }

    // 업데이트 일자가 있는 것만 필터링하고 최신순으로 정렬
    const updatesWithDate = vendorUpdates
      .filter(v => v.lastUpdateDate)
      .sort((a, b) => {
        if (!a.lastUpdateDate || !b.lastUpdateDate) return 0;
        return new Date(b.lastUpdateDate).getTime() - new Date(a.lastUpdateDate).getTime();
      });

    console.log('📊 벤더별 업데이트 정보 조회 완료:', {
      totalVendors: vendorUpdates.length,
      updatesWithDate: updatesWithDate.length,
    });

    return NextResponse.json({
      success: true,
      data: {
        vendorUpdates,
        updatesWithDate,
      },
    });
  } catch (error) {
    console.error('❌ 벤더별 업데이트 정보 조회 오류:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: '벤더별 업데이트 정보 조회 실패',
        data: {
          vendorUpdates: [],
          updatesWithDate: [],
        },
      },
      { status: 500 }
    );
  }
}

