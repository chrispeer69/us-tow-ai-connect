/** @type {import('next').NextConfig} */
const apiTarget = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle at .next/standalone for the Railway
  // Dockerfile to ship. Without this the runtime image needs the entire
  // node_modules tree.
  output: 'standalone',
  // Standalone mode resolves workspace deps from the repo root; tell Next
  // where that root lives so it traces files correctly.
  outputFileTracingRoot: require('path').join(__dirname, '../..'),
  transpilePackages: ['@ustow/shared'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiTarget}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
