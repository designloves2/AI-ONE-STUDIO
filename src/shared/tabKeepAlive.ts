// tabKeepAlive.ts — 오래 걸리는 생성(One-Take 릴레이 등) 도중 크롬/파이어폭스가 백그라운드
// 탭을 스스로 디스카드(메모리 절약을 위해 몰래 리로드)하는 걸 막는다. 사용자가 새로고침을
// 안 눌러도 탭이 리셋된 것처럼 보이는 증상이 바로 이거 — 브라우저는 소리를 내고 있는 탭은
// 절대 디스카드하지 않으므로, 생성 중엔 거의 무음(볼륨 최소치)에 가까운 루프를 틀어서
// "이 탭은 지금 활성 상태"라고 브라우저에게 알려준다.
let audioEl: HTMLAudioElement | null = null;
let refCount = 0;

function silentLoopUrl(durationSec = 2, sampleRate = 8000): string {
  const numSamples = durationSec * sampleRate;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, numSamples * 2, true);
  // 20Hz, 아주 작은 진폭 — 오디오 스트림 자체는 "재생 중"으로 잡히지만 실제로는
  // 거의 안 들림(볼륨도 별도로 더 낮춰서 이중으로 무음에 가깝게 만든다).
  const freq = 20;
  const amp = 200;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const v = Math.round(amp * Math.sin(2 * Math.PI * freq * t));
    view.setInt16(44 + i * 2, v, true);
  }
  const blob = new Blob([buffer], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

/** on=true로 부를 때마다 참조 카운트가 늘고, off로 0이 되면 정지 — 여러 곳에서 동시에 켜둬도 안전. */
export function keepTabAlive(on: boolean) {
  if (on) {
    refCount++;
    if (!audioEl) {
      audioEl = new Audio(silentLoopUrl());
      audioEl.loop = true;
      audioEl.volume = 0.02;
    }
    audioEl.play().catch(() => {});
  } else {
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0 && audioEl) audioEl.pause();
  }
}
