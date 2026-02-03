"use client";

export default function DebugPage() {
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-center text-white">
        <h1 className="text-4xl font-bold mb-4">Debug Page</h1>
        <p className="text-xl">This is a simple debug page to test routing.</p>
        <p className="text-sm text-gray-400 mt-4">Current time: {new Date().toLocaleString()}</p>
      </div>
    </div>
  );
}
