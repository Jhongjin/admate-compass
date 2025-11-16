/**
 * 비용 모니터링 API
 * Supabase 및 Vercel 사용량 추적 및 예산 관리
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 월 예산 설정 (달러)
const MONTHLY_BUDGET = 200;

interface CostMetrics {
  supabase: {
    database: {
      size: number; // MB
      sizeFormatted: string;
      estimatedCost: number; // 달러
      estimatedCostFormatted: string;
    };
    storage: {
      size: number; // MB
      sizeFormatted: string;
      estimatedCost: number; // 달러
      estimatedCostFormatted: string;
    };
    bandwidth: {
      usage: number; // GB
      usageFormatted: string;
      estimatedCost: number; // 달러
      estimatedCostFormatted: string;
    };
    total: {
      estimatedCost: number; // 달러
      estimatedCostFormatted: string;
    };
  };
  vercel: {
    functionInvocations: {
      count: number;
      estimatedCost: number; // 달러
      estimatedCostFormatted: string;
    };
    bandwidth: {
      usage: number; // GB
      usageFormatted: string;
      estimatedCost: number; // 달러
      estimatedCostFormatted: string;
    };
    total: {
      estimatedCost: number; // 달러
      estimatedCostFormatted: string;
    };
  };
  total: {
    estimatedCost: number; // 달러
    estimatedCostFormatted: string;
    budgetUsage: number; // 퍼센트
    budgetRemaining: number; // 달러
    status: 'healthy' | 'warning' | 'critical';
  };
  trends: {
    daily: Array<{
      date: string;
      supabase: number;
      vercel: number;
      total: number;
    }>;
    monthly: Array<{
      month: string;
      supabase: number;
      vercel: number;
      total: number;
    }>;
  };
  alerts: Array<{
    type: 'budget' | 'usage' | 'anomaly';
    severity: 'info' | 'warning' | 'critical';
    message: string;
    timestamp: string;
  }>;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createPureClient();
    
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Supabase 클라이언트를 생성할 수 없습니다.' },
        { status: 500 }
      );
    }

    // 1. Supabase 데이터베이스 크기 조회
    // 대안: documents 및 chunks 테이블 크기 합산 (pg_database_size는 권한 문제로 실패할 수 있음)
    const { data: tableSizes, error: tableSizeError } = await supabase
      .from('documents')
      .select('file_size, chunk_count');
    
    let databaseSizeMB = 0;
    if (tableSizes) {
      const totalFileSize = tableSizes.reduce((sum, doc) => sum + (doc.file_size || 0), 0);
      // 청크 데이터는 평균 1KB로 추정 (임베딩 포함)
      const totalChunkSize = tableSizes.reduce((sum, doc) => sum + (doc.chunk_count || 0) * 1024, 0);
      databaseSizeMB = (totalFileSize + totalChunkSize) / (1024 * 1024);
    }

    // 2. Supabase Storage 크기 조회
    const { data: storageFiles, error: storageError } = await supabase
      .storage
      .from('documents')
      .list('', { limit: 1000 });
    
    let storageSizeMB = 0;
    if (storageFiles) {
      storageSizeMB = storageFiles.reduce((sum, file) => sum + (file.metadata?.size || 0), 0) / (1024 * 1024);
    }

    // 3. 문서 및 청크 통계
    const { count: documentCount } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true });
    
    const { count: chunkCount } = await supabase
      .from('document_chunks')
      .select('*', { count: 'exact', head: true });
    
    const { count: jobCount } = await supabase
      .from('processing_jobs')
      .select('*', { count: 'exact', head: true });

    // 4. 비용 추정 (Supabase Pro 플랜 기준)
    // - 데이터베이스: $0.125/GB/월
    // - Storage: $0.021/GB/월
    // - Bandwidth: $0.09/GB
    const supabaseDatabaseCost = (databaseSizeMB / 1024) * 0.125;
    const supabaseStorageCost = (storageSizeMB / 1024) * 0.021;
    const supabaseBandwidthCost = 0; // 실제 사용량은 Supabase 대시보드에서 확인 필요
    const supabaseTotalCost = supabaseDatabaseCost + supabaseStorageCost + supabaseBandwidthCost;

    // 5. Vercel 비용 추정 (Pro 플랜 기준)
    // - Function Invocations: Pro 플랜에는 포함됨 (추가 비용 없음)
    // - Bandwidth: Pro 플랜에는 1TB 포함, 초과 시 $0.15/GB
    const vercelFunctionCost = 0; // Pro 플랜에 포함
    const vercelBandwidthCost = 0; // 1TB 이내는 무료
    const vercelTotalCost = vercelFunctionCost + vercelBandwidthCost;

    // 6. 총 비용 계산
    const totalCost = supabaseTotalCost + vercelTotalCost;
    const budgetUsage = (totalCost / MONTHLY_BUDGET) * 100;
    const budgetRemaining = MONTHLY_BUDGET - totalCost;
    
    // 7. 상태 결정
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (budgetUsage >= 90) {
      status = 'critical';
    } else if (budgetUsage >= 70) {
      status = 'warning';
    }

    // 8. 알림 생성
    const alerts: CostMetrics['alerts'] = [];
    if (budgetUsage >= 90) {
      alerts.push({
        type: 'budget',
        severity: 'critical',
        message: `월 예산의 ${budgetUsage.toFixed(1)}%를 사용했습니다. 예산 초과 위험이 있습니다.`,
        timestamp: new Date().toISOString()
      });
    } else if (budgetUsage >= 70) {
      alerts.push({
        type: 'budget',
        severity: 'warning',
        message: `월 예산의 ${budgetUsage.toFixed(1)}%를 사용했습니다. 비용 모니터링을 권장합니다.`,
        timestamp: new Date().toISOString()
      });
    }

    // 9. 트렌드 데이터 (최근 7일, 최근 3개월)
    // 실제 구현 시에는 historical_cost 테이블에서 조회
    const trends = {
      daily: Array.from({ length: 7 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - i));
        return {
          date: date.toISOString().split('T')[0],
          supabase: supabaseTotalCost / 7, // 일일 평균
          vercel: vercelTotalCost / 7,
          total: totalCost / 7
        };
      }),
      monthly: Array.from({ length: 3 }, (_, i) => {
        const date = new Date();
        date.setMonth(date.getMonth() - (2 - i));
        return {
          month: date.toISOString().slice(0, 7),
          supabase: supabaseTotalCost / 3, // 월 평균
          vercel: vercelTotalCost / 3,
          total: totalCost / 3
        };
      })
    };

    const costMetrics: CostMetrics = {
      supabase: {
        database: {
          size: databaseSizeMB,
          sizeFormatted: `${databaseSizeMB.toFixed(2)} MB`,
          estimatedCost: supabaseDatabaseCost,
          estimatedCostFormatted: `$${supabaseDatabaseCost.toFixed(2)}`
        },
        storage: {
          size: storageSizeMB,
          sizeFormatted: `${storageSizeMB.toFixed(2)} MB`,
          estimatedCost: supabaseStorageCost,
          estimatedCostFormatted: `$${supabaseStorageCost.toFixed(2)}`
        },
        bandwidth: {
          usage: 0, // 실제 사용량은 Supabase 대시보드에서 확인 필요
          usageFormatted: '0 GB',
          estimatedCost: supabaseBandwidthCost,
          estimatedCostFormatted: `$${supabaseBandwidthCost.toFixed(2)}`
        },
        total: {
          estimatedCost: supabaseTotalCost,
          estimatedCostFormatted: `$${supabaseTotalCost.toFixed(2)}`
        }
      },
      vercel: {
        functionInvocations: {
          count: jobCount || 0,
          estimatedCost: vercelFunctionCost,
          estimatedCostFormatted: `$${vercelFunctionCost.toFixed(2)}`
        },
        bandwidth: {
          usage: 0, // 실제 사용량은 Vercel 대시보드에서 확인 필요
          usageFormatted: '0 GB',
          estimatedCost: vercelBandwidthCost,
          estimatedCostFormatted: `$${vercelBandwidthCost.toFixed(2)}`
        },
        total: {
          estimatedCost: vercelTotalCost,
          estimatedCostFormatted: `$${vercelTotalCost.toFixed(2)}`
        }
      },
      total: {
        estimatedCost: totalCost,
        estimatedCostFormatted: `$${totalCost.toFixed(2)}`,
        budgetUsage: budgetUsage,
        budgetRemaining: budgetRemaining,
        status: status
      },
      trends: trends,
      alerts: alerts
    };

    return NextResponse.json({
      success: true,
      data: costMetrics,
      metadata: {
        documentCount: documentCount || 0,
        chunkCount: chunkCount || 0,
        jobCount: jobCount || 0,
        monthlyBudget: MONTHLY_BUDGET,
        lastUpdated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ 비용 모니터링 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '비용 모니터링 데이터 조회 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}

