import { NextRequest, NextResponse } from 'next/server';
import { guardCompassProductAdminSessionRoute } from '@/lib/adminProductSessionGuard';

export async function POST(request: NextRequest) {
  const sessionGuard = guardCompassProductAdminSessionRoute(request);
  if (sessionGuard) return sessionGuard;

  return NextResponse.json(
    {
      success: false,
      code: 'SIMPLE_DUMMY_INDEXING_DISABLED',
      error: '간단 더미 인덱싱 경로는 비활성화되었습니다.',
      message: '공식 가이드 코퍼스는 실제 추출 청크와 임베딩이 있는 경로만 사용할 수 있습니다. Source Ops 승인 경로나 공식 가이드 그래프 백필 경로를 사용하세요.',
    },
    { status: 410 },
  );
}
