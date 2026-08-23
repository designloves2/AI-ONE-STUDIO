import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    // true = 0.0.0.0(모든 인터페이스)에 바인딩 — LAN의 다른 컴퓨터가 http://<이 PC의
    // LAN IP>:8774로 직접 접근 가능. 외부 터널(ngrok/cloudflared 등)은 그대로 이 포트로
    // 포워딩하면 되고, studio.tjtj.cloud 같은 도메인 접근은 allowedHosts로 계속 허용한다.
    // 127.0.0.1로 고정돼 있었을 때는 LAN IP로 접속한 다른 컴퓨터가 페이지는(프록시 경유로)
    // 받아도 Vite의 HMR 웹소켓만 이 호스트에 못 붙어 재연결을 반복하다 계속 새로고침되는
    // 증상이 있었다 — host를 실제로 열어야 HMR 클라이언트도 같은 주소로 정상 연결된다.
    host: true,
    port: 8774,
    strictPort: true,
    allowedHosts: ["studio.tjtj.cloud"],
  },
});
