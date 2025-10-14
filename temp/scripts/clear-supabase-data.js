// Supabase 데이터 전체 삭제 스크립트
const { createClient } = require('@supabase/supabase-js');

async function clearAllData() {
  console.log('🗑️ Supabase 데이터 전체 삭제 시작...\n');

  // 환경변수 확인
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Supabase 환경변수가 설정되지 않았습니다.');
    console.log('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '설정됨' : '없음');
    console.log('SUPABASE_SERVICE_ROLE_KEY:', supabaseKey ? '설정됨' : '없음');
    return;
  }

  try {
    // Supabase 클라이언트 생성
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ Supabase 클라이언트 생성 완료');

    // 1. document_chunks 테이블 삭제
    console.log('📄 document_chunks 테이블 데이터 삭제 중...');
    const { error: chunksError } = await supabase
      .from('document_chunks')
      .delete()
      .neq('id', 0); // 모든 데이터 삭제

    if (chunksError) {
      console.error('❌ document_chunks 삭제 오류:', chunksError);
    } else {
      console.log('✅ document_chunks 삭제 완료');
    }

    // 2. document_metadata 테이블 삭제
    console.log('📊 document_metadata 테이블 데이터 삭제 중...');
    const { error: metadataError } = await supabase
      .from('document_metadata')
      .delete()
      .neq('id', 0); // 모든 데이터 삭제

    if (metadataError) {
      console.error('❌ document_metadata 삭제 오류:', metadataError);
    } else {
      console.log('✅ document_metadata 삭제 완료');
    }

    // 3. documents 테이블 삭제
    console.log('📚 documents 테이블 데이터 삭제 중...');
    const { error: documentsError } = await supabase
      .from('documents')
      .delete()
      .neq('id', 0); // 모든 데이터 삭제

    if (documentsError) {
      console.error('❌ documents 삭제 오류:', documentsError);
    } else {
      console.log('✅ documents 삭제 완료');
    }

    // 4. 삭제 확인
    console.log('\n🔍 삭제 결과 확인 중...');
    
    const { data: documents, error: docCheckError } = await supabase
      .from('documents')
      .select('count')
      .limit(1);

    const { data: chunks, error: chunkCheckError } = await supabase
      .from('document_chunks')
      .select('count')
      .limit(1);

    const { data: metadata, error: metadataCheckError } = await supabase
      .from('document_metadata')
      .select('count')
      .limit(1);

    console.log('📊 삭제 후 데이터 수:');
    console.log('  - documents:', documents?.length || 0);
    console.log('  - document_chunks:', chunks?.length || 0);
    console.log('  - document_metadata:', metadata?.length || 0);

    console.log('\n🎉 Supabase 데이터 전체 삭제 완료!');
    console.log('이제 새로운 파일들을 업로드하여 테스트할 수 있습니다.');

  } catch (error) {
    console.error('❌ 데이터 삭제 중 오류 발생:', error);
  }
}

clearAllData();


