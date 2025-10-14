# RAG 시스템 테스트 (PowerShell)
Write-Host "🧪 RAG 시스템 테스트 시작..." -ForegroundColor Green

$testQuestions = @(
    "Meta 광고는 어떻게 만드나요?",
    "Facebook 광고 예산은 얼마나 설정해야 하나요?",
    "Instagram 광고의 최적화 방법은 무엇인가요?"
)

foreach ($i in 0..($testQuestions.Length - 1)) {
    $question = $testQuestions[$i]
    Write-Host "`n📝 테스트 $($i + 1): `"$question`"" -ForegroundColor Yellow
    Write-Host "─" * 50 -ForegroundColor Gray
    
    try {
        $body = @{
            message = $question
        } | ConvertTo-Json
        
        $response = Invoke-RestMethod -Uri "http://localhost:3000/api/chat" -Method POST -Body $body -ContentType "application/json"
        
        if ($response.error) {
            Write-Host "❌ API 오류: $($response.error)" -ForegroundColor Red
            continue
        }
        
        Write-Host "✅ 답변: $($response.answer.Substring(0, [Math]::Min(200, $response.answer.Length)))..." -ForegroundColor Green
        Write-Host "📊 신뢰도: $($response.confidence)%" -ForegroundColor Cyan
        Write-Host "🔗 출처: $($response.sources.Count)개" -ForegroundColor Cyan
        Write-Host "⏱️ 처리 시간: $($response.processingTime)ms" -ForegroundColor Cyan
        Write-Host "🤖 모델: $($response.model)" -ForegroundColor Cyan
        
        if ($response.sources -and $response.sources.Count -gt 0) {
            Write-Host "📚 출처 문서:" -ForegroundColor Magenta
            for ($j = 0; $j -lt $response.sources.Count; $j++) {
                $source = $response.sources[$j]
                Write-Host "  $($j + 1). $($source.documentTitle) (유사도: $([math]::Round($source.similarity, 3)))" -ForegroundColor White
            }
        }
        
    } catch {
        Write-Host "❌ 요청 오류: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    Start-Sleep -Seconds 1
}

Write-Host "`n🎉 RAG 시스템 테스트 완료!" -ForegroundColor Green


