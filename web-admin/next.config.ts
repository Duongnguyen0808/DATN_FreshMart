import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  allowedDevOrigins: [
    'freshmart-iot.store',
    '*.freshmart-iot.store',
    'localhost:3000',
  ],
  async headers() {
    if (!isDev) {
      return [
        {
          source: '/products/:path*',
          headers: [
            { key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' },
          ],
        },
        {
          source: '/fonts/:path*',
          headers: [
            { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          ],
        },
      ];
    }
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0' },
          { key: 'CDN-Cache-Control', value: 'no-store' },
          { key: 'Cloudflare-CDN-Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default nextConfig;
