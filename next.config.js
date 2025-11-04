/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        hostname: '**',
      },
    ],
  },
  // Next.js 14.x 안정성 설정
  experimental: {
    serverComponentsExternalPackages: ['@supabase/supabase-js', 'pdf-parse'],
    optimizeCss: true, // Vercel Pro 플랜 사용 중이므로 활성화
    optimizePackageImports: [
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-accordion',
      'lucide-react',
      '@tanstack/react-query',
    ],
  },
  
  // 프로덕션 빌드 최적화
  productionBrowserSourceMaps: false,
  
  // 컴파일러 최적화
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },
  
  // API 라우트 bodyParser는 Next.js 14에서 자동으로 처리됨
  // 파일 크기 제한은 route.ts에서 export const maxDuration으로 설정
  
  // Webpack 설정 단순화
  webpack: (config, { isServer }) => {
    // 클라이언트 사이드에서 서버 전용 모듈 제외
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        crypto: false,
        net: false,
        tls: false,
        dns: false,
      };
    }

    // 바이너리 파일 처리 설정
    config.module.rules.push({
      test: /\.node$/,
      use: 'node-loader',
    });

    // onnxruntime-node 바이너리 파일 제외
    config.externals = config.externals || [];
    config.externals.push({
      'onnxruntime-node': 'commonjs onnxruntime-node',
    });

    return config;
  },
};

module.exports = nextConfig;

