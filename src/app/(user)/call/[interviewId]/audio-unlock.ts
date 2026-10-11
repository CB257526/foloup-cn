/**
 * iOS Safari 音频解锁「预热」—— 客户端工具（P3 名下，新建文件）
 *
 * 背景：iOS Safari 上 `AudioContext` 必须在**用户手势之后**创建/`resume()`，
 *       否则会是 suspended 状态、听不到声音。
 *       P1 的通话组件已在 `start()` 里做了 resume（见 `进度/P1-语音层.md` 第 4 节），
 *       但 `start()` 里在真正建 AudioContext 之前有两次 await（换会话参数、建应答记录），
 *       手势上下文可能已经过期 —— 且 P1 明确写了**未做真机验证**。
 *
 * 本文件的作用（P3 能做的、不改通话组件的那部分加固）：
 *   在候选人**第一次触摸/点击页面**时（例如勾选同意、点「同意并开始面试」），
 *   主动创建并 `resume()` 一个 AudioContext，再播放 1 帧静音 buffer ——
 *   让整个文档的音频通道在该手势内被解锁。之后再回到通话页，
 *   通话组件新建自己的 AudioContext 时通常就能直接 running。
 *
 * ⚠️ 这不是「真机已验证」，只是把解锁时机提前。真实手机上的录音链路
 *    仍由主控在真机复验（本机无头浏览器拿不到麦克风）。
 * ⚠️ 本文件不修改、不依赖 `src/components/call/**` 的任何内部实现。
 */

type AudioContextCtor = typeof AudioContext;

let primedContext: AudioContext | null = null;
let silencePlayed = false;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };

  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * 在用户手势里调用一次即可（重复调用是安全的）。
 * 任何异常都被吞掉：解锁失败也不能挡住候选人面试。
 */
export function primeAudioContext(): void {
  const Ctor = getAudioContextCtor();

  if (!Ctor) {
    return;
  }

  try {
    if (!primedContext || primedContext.state === "closed") {
      primedContext = new Ctor();
    }
    // 可能是 "suspended"（iOS）或 "interrupted"（来电等）
    if (primedContext.state !== "running") {
      void primedContext.resume().catch(() => undefined);
    }
    if (!silencePlayed) {
      // 播放 1 帧静音：部分 iOS 版本只有真正「播出过声音」才算解锁
      const buffer = primedContext.createBuffer(1, 1, primedContext.sampleRate);
      const source = primedContext.createBufferSource();

      source.buffer = buffer;
      source.connect(primedContext.destination);
      source.start(0);
      silencePlayed = true;
    }
  } catch {
    // 忽略：iOS 上不满足条件时构造/播放会抛异常
  }
}

/** 让候选人在「第一次触摸页面」时就完成解锁（capture 阶段，避免被组件 stopPropagation 挡掉） */
export function primeAudioOnFirstGesture(): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = () => primeAudioContext();

  window.addEventListener("pointerdown", handler, { once: true, capture: true });
  window.addEventListener("touchend", handler, { once: true, capture: true });

  return () => {
    window.removeEventListener("pointerdown", handler, { capture: true });
    window.removeEventListener("touchend", handler, { capture: true });
  };
}
