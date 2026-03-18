const http = require('http');

console.log('🚀 [Auto Queue Consumer] Starting the background job processor...');
console.log('⏳ Periodically calling /api/jobs/consume every 10 seconds.');

// 재귀적 호출로 변경하여 이전 요청이 완료된 후 다음 요청이 시작되도록 함 (동시성 제어)
function scheduleNext() {
    setTimeout(() => {
        triggerConsume();
    }, 10000); // 10초 대기
}

function triggerConsume() {
    const options = {
        hostname: '127.0.0.1',
        port: 3000,
        path: '/api/jobs/consume',
        method: 'POST',
    };

    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                if (json.success) {
                    console.log(`[${new Date().toLocaleTimeString()}] ✅ Job triggered successfully:`, json.message || 'Processing queue...');
                } else if (json.message === 'No jobs to process') {
                    console.log(`[${new Date().toLocaleTimeString()}] 💤 Queue is empty. Waiting...`);
                } else {
                    console.log(`[${new Date().toLocaleTimeString()}] ⚠️ API response:`, json);
                }
            } catch (err) {
                console.error(`[${new Date().toLocaleTimeString()}] ❌ Failed to parse response:`, data);
            }
            scheduleNext(); // 완료 후 다음 스케줄
        });
    });

    req.on('error', (error) => {
        console.error(`[${new Date().toLocaleTimeString()}] 🚨 Network Error:`, error.message);
        if (error.code === 'ECONNREFUSED') {
            console.error('👉 Make sure the Next.js server (npm run dev) is running on port 3000.');
        }
        scheduleNext(); // 에러 발생 시에도 다음 스케줄
    });

    req.end();
}

// 처음 2회 동시 실행 (동시성 2로 제한)
triggerConsume();
setTimeout(triggerConsume, 2000); // 2초 뒤 두 번째 워커 시작
