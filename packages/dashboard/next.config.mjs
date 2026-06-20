/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // node:sqlite is a built-in; keep it external to the server bundle.
    serverComponentsExternalPackages: ["node:sqlite"],
  },
};
export default nextConfig;
