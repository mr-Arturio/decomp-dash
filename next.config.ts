/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizePackageImports: [
      "@tensorflow-models/mobilenet",
      "@tensorflow/tfjs",
      "lucide-react",
    ],
  },
};
export default nextConfig;
