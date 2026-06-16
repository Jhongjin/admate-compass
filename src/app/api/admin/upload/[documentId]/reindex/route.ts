import { NextRequest, NextResponse } from 'next/server';
import { guardCompassProductAdminSessionRoute } from '@/lib/adminProductSessionGuard';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const sessionGuard = guardCompassProductAdminSessionRoute(request);
  if (sessionGuard) return sessionGuard;

  const { documentId } = await params;

  if (!documentId) {
    return NextResponse.json(
      {
        success: false,
        error: '문서 ID가 필요합니다.',
      },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      success: false,
      code: 'REINDEX_FAIL_CLOSED',
      error: '안전한 재인덱싱 경로가 아직 연결되지 않았습니다.',
      message: '기존 청크를 삭제하거나 더미 청크를 생성하지 않습니다. Source Ops 승인 경로, 실제 추출 파이프라인, 또는 공식 가이드 그래프 백필 경로를 사용하세요.',
      document: {
        id: documentId,
      },
    },
    { status: 409 },
  );
}
