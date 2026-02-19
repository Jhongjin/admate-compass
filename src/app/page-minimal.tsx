export default function MinimalPage() {
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-center text-white">
        <h1 className="text-6xl font-bold mb-8">Ad-Mate</h1>
        <p className="text-2xl mb-8">AI-powered Meta advertising FAQ chatbot</p>
        <div className="space-y-4">
          <a 
            href="/chat" 
            className="inline-block px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
          >
            채팅 시작하기
          </a>
          <br />
          <a 
            href="/admin" 
            className="inline-block px-8 py-4 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg transition-colors"
          >
            관리자 페이지
          </a>
        </div>
      </div>
    </div>
  );
}
