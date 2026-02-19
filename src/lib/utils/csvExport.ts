/**
 * CSV 내보내기 유틸리티 함수들
 * 한글 인코딩 문제 해결 및 Excel 호환성 개선
 */

export interface CSVExportOptions {
  filename?: string;
  includeBOM?: boolean;
  encoding?: string;
}

/**
 * CSV 필드 이스케이핑 함수
 * RFC 4180 표준에 따른 CSV 이스케이핑
 */
export function escapeCSVField(field: any): string {
  const str = String(field);
  
  // 쉼표, 따옴표, 줄바꿈, 캐리지 리턴이 포함된 경우 따옴표로 감싸기
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    // 내부 따옴표는 두 개의 따옴표로 이스케이핑
    return `"${str.replace(/"/g, '""')}"`;
  }
  
  return str;
}

/**
 * 2차원 배열을 CSV 문자열로 변환
 */
export function arrayToCSV(data: any[][], options: CSVExportOptions = {}): string {
  const { includeBOM = true } = options;
  
  // 각 행을 CSV 형식으로 변환
  const csvRows = data.map(row => 
    row.map(field => escapeCSVField(field)).join(',')
  );
  
  const csvContent = csvRows.join('\n');
  
  // UTF-8 BOM 추가 (Excel에서 한글 인식용)
  if (includeBOM) {
    const BOM = '\uFEFF';
    return BOM + csvContent;
  }
  
  return csvContent;
}

/**
 * CSV 파일 다운로드 함수
 */
export function downloadCSV(
  data: any[][], 
  filename: string = `export_${new Date().toISOString().split('T')[0]}.csv`,
  options: CSVExportOptions = {}
): void {
  const csvContent = arrayToCSV(data, options);
  
  // Blob 생성
  const blob = new Blob([csvContent], { 
    type: 'text/csv;charset=utf-8;' 
  });
  
  // 다운로드 링크 생성 및 클릭
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // 메모리 정리
  URL.revokeObjectURL(url);
}

/**
 * 통계 데이터를 CSV 형식으로 변환하는 헬퍼 함수
 */
export function createStatsCSVData(stats: {
  totalQuestions: number;
  activeUsers: number;
  avgResponseTime: string;
  satisfactionRate: number;
  totalDocuments: number;
  indexedDocuments: number;
  totalFeedback: number;
  positiveFeedback: number;
  negativeFeedback: number;
  weeklyChange: {
    questions: number;
    users: number;
    responseTime: number;
    satisfaction: number;
  };
}): any[][] {
  return [
    ['항목', '값', '변화율', '설명'],
    ['총 질문 수', stats.totalQuestions, `${stats.weeklyChange.questions}%`, '전체 질문 수'],
    ['활성 사용자', stats.activeUsers, `${stats.weeklyChange.users}%`, '활성 사용자 수'],
    ['평균 응답 시간', stats.avgResponseTime, `${stats.weeklyChange.responseTime}%`, '평균 응답 시간'],
    ['만족도', `${stats.satisfactionRate}%`, `${stats.weeklyChange.satisfaction}%`, '사용자 만족도'],
    ['총 문서 수', stats.totalDocuments, '0%', '업로드된 총 문서 수'],
    ['인덱싱된 문서', stats.indexedDocuments, '0%', '검색 가능한 문서 수'],
    ['총 피드백', stats.totalFeedback, '0%', '전체 피드백 수'],
    ['긍정 피드백', stats.positiveFeedback, '0%', '도움됨 피드백 수'],
    ['부정 피드백', stats.negativeFeedback, '0%', '도움안됨 피드백 수'],
  ];
}

/**
 * 피드백 통계를 CSV 형식으로 변환하는 헬퍼 함수
 */
export function createFeedbackCSVData(feedbackStats: {
  total?: number;
  positive?: number;
  negative?: number;
  positivePercentage?: number;
  dailyStats?: Array<{
    date: string;
    positive: number;
    negative: number;
    total: number;
  }>;
}): any[][] {
  const data: any[][] = [
    ['구분', '수량', '비율', '설명'],
    ['총 피드백', feedbackStats.total || 0, '100%', '전체 피드백 수'],
    ['긍정 피드백', feedbackStats.positive || 0, `${feedbackStats.positivePercentage || 0}%`, '도움됨 피드백'],
    ['부정 피드백', feedbackStats.negative || 0, `${100 - (feedbackStats.positivePercentage || 0)}%`, '도움안됨 피드백'],
  ];

  // 일별 통계가 있는 경우 추가
  if (feedbackStats.dailyStats && feedbackStats.dailyStats.length > 0) {
    data.push(['', '', '', '']); // 빈 행
    data.push(['날짜', '긍정', '부정', '총합']); // 헤더
    
    feedbackStats.dailyStats.forEach(day => {
      data.push([
        new Date(day.date).toLocaleDateString('ko-KR'),
        day.positive,
        day.negative,
        day.total
      ]);
    });
  }

  return data;
}
