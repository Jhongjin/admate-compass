import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * 기존 문서들에 대해 원본 파일 데이터가 없는 경우 텍스트 추출 내용을 저장
 */
async function migrateFileData() {
  try {
    console.log('파일 데이터 마이그레이션 시작...');

    // 모든 파일 타입 문서 조회
    const { data: documents, error: docError } = await supabase
      .from('documents')
      .select('*')
      .in('type', ['file', 'pdf', 'docx', 'txt']);

    if (docError) {
      throw new Error(`문서 조회 실패: ${docError.message}`);
    }

    console.log(`총 ${documents?.length || 0}개 파일 문서 발견`);

    for (const doc of documents || []) {
      try {
        // 이미 메타데이터가 있는지 확인
        const { data: existingMetadata } = await supabase
          .from('document_metadata')
          .select('*')
          .eq('id', doc.id)
          .single();

        if (existingMetadata?.metadata?.fileData) {
          console.log(`문서 ${doc.title}은 이미 파일 데이터가 있습니다. 건너뜀.`);
          continue;
        }

        // 청크 데이터를 가져와서 텍스트로 저장
        const { data: chunks } = await supabase
          .from('document_chunks')
          .select('content')
          .eq('document_id', doc.id)
          .order('chunk_index', { ascending: true });

        if (!chunks || chunks.length === 0) {
          console.log(`문서 ${doc.title}에 청크가 없습니다. 건너뜀.`);
          continue;
        }

        // 청크들을 합쳐서 텍스트 생성
        const fullText = chunks.map(chunk => chunk.content).join('\n\n');
        const textBuffer = Buffer.from(fullText, 'utf-8');
        const base64Data = textBuffer.toString('base64');

        // 메타데이터 저장
        await supabase
          .from('document_metadata')
          .upsert({
            id: doc.id,
            metadata: {
              fileData: base64Data,
              originalFileName: doc.title,
              originalFileType: doc.type === 'pdf' ? 'application/pdf' : 
                              doc.type === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
                              'text/plain',
              originalFileSize: fullText.length,
              type: 'file',
              uploadedAt: doc.created_at,
              isExtractedText: true // 추출된 텍스트임을 표시
            }
          });

        console.log(`문서 ${doc.title} 마이그레이션 완료 (${chunks.length}개 청크)`);

      } catch (error) {
        console.error(`문서 ${doc.title} 마이그레이션 실패:`, error);
      }
    }

    console.log('파일 데이터 마이그레이션 완료!');

  } catch (error) {
    console.error('마이그레이션 오류:', error);
  }
}

// 스크립트 실행
if (require.main === module) {
  migrateFileData();
}

export { migrateFileData };


