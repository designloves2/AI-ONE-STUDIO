import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    // 127.0.0.1로 고정 — "localhost" 문자열이 아니라 실제 루프백 IP에 바인딩해야
    // 이후 외부 터널(ngrok/cloudflared 등)이 이 주소로 정확히 포워딩할 수 있다.
    host: "127.0.0.1",
    port: 8774,
    strictPort: true,
    allowedHosts: ["studio.tjtj.cloud"],
  },
});
