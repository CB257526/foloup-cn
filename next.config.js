/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      // 简历 PDF 经由 Server Action 上传（src/actions/parse-pdf.ts）。
      // Server Action 的请求体默认上限只有 1MB，而上传组件允许选 10MB 以内的文件 ——
      // 超过 1MB 的 PDF 会被服务端直接拒掉，页面上只显示含糊的"读取 PDF 失败"。
      // 这里放宽到 10MB，与界面提示保持一致。
      bodySizeLimit: "10mb",
    },
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/dashboard",
        permanent: true,
      },
    ];
  },
  images: {
    remotePatterns: [
      // Clerk 头像域名（原版多租户残留）—— 已删账号系统，改为允许占位图服务
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
    ],
  },
  // better-sqlite3 是原生模块，必须排除在打包之外，否则 server bundle 会报找不到 .node
  serverExternalPackages: ["better-sqlite3"],
  webpack: (webpackConfig, { webpack }) => {
    webpackConfig.plugins.push(
      // Remove node: from import specifiers, because Next.js does not yet support node: scheme
      // https://github.com/vercel/next.js/issues/28774
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
        resource.request = resource.request.replace(/^node:/, "");
      }),
    );

    return webpackConfig;
  },
};

module.exports = nextConfig;
