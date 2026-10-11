/**
 * 通义实时语音客户端（浏览器直连 WebSocket）
 *
 * ⚠️ 本文件的每一行协议细节都来自 `POC验证报告.md` 与 `交接文档.md` 第 6 节的**实测结果**，
 *    参考实现是 `poc/index.html`（平均延迟 0.88s / 连续 5 分钟不断线 / 打断 68 次全部生效）。
 *    **不要凭 OpenAI 官方文档改动下面的参数** —— 已踩过 3 个坑：
 *      1. 候选人转录是**累计**字段 text（+ stash），不是增量 delta；照 delta 写会一直空白。
 *      2. modalities 只能是 ["text","audio"] 或 ["text"]；["audio"] 会被掐断（close 1007）。
 *      3. 音色填错会**直接掐断连接**（不是返回错误）。
 *
 * 音频链路：
 *   麦克风(或测试音频) → AudioWorklet(每 100ms 一帧 Float32) → PCM16 → base64
 *     → WebSocket(input_audio_buffer.append) → 平台 → response.audio.delta(PCM 24k)
 *     → AudioBuffer 排队播放（用户开口时立即 stop，实现打断）
 */

/** 上行采样率：平台要求 16kHz PCM 单声道 16bit */
export const SAMPLE_RATE_IN = 16000;
/** 下行采样率：平台返回 24kHz PCM 单声道 16bit */
export const SAMPLE_RATE_OUT = 24000;

/**
 * AudioWorklet 采集处理器。
 * 每 100ms 上报一帧（帧长按 AudioContext 实际采样率算，避免 Safari 上采样率不一致导致时长漂移）。
 */
const WORKLET_SOURCE = `
class PCMCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(Math.round(sampleRate / 10));
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.slice(0));
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMCapture);
`;

export type RealtimeStatus = "idle" | "connecting" | "live" | "closed" | "error";

export type Turn = {
  id: string;
  role: "agent" | "user";
  content: string;
  /** true = 这句话还在边说边出（UI 上可半透明显示） */
  live: boolean;
  /** 距会话开始的毫秒偏移 */
  offset_ms: number;
};

export type RealtimeStats = {
  latency_samples: number[];
  interruption_count: number;
  audio_chunks: number;
  audio_bytes: number;
  /** 连接期间收到的各类服务端事件计数（排查用） */
  events: Record<string, number>;
};

export type SessionConfig = {
  /** WebSocket 基址，形如 wss://host/api-ws/v1/realtime（不要带查询参数） */
  wsUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  instructions: string;
  /** 让 AI 主动开场的指令（会作为 response.instructions 下发） */
  greeting?: string;
  /** 服务端下发的会话参数，原样透传 */
  session?: Record<string, unknown>;
};

export type ClientCallbacks = {
  onStatus?: (status: RealtimeStatus, detail?: string) => void;
  onTurns?: (turns: Turn[]) => void;
  /** 当前谁在说话（用于 UI 高亮） */
  onSpeaker?: (speaker: "agent" | "user" | null) => void;
  /** 麦克风输入电平 0~1（画电平条） */
  onLevel?: (rms: number) => void;
  /** 本轮「用户说完 → AI 出声」的延迟（秒） */
  onLatency?: (seconds: number) => void;
  onError?: (message: string) => void;
};

/* ────────────────── 音频工具函数 ────────────────── */

function f32ToI16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function i16ToF32(i16: Int16Array): Float32Array {
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) {
    out[i] = i16[i] / 32768;
  }
  return out;
}

function b64Encode(i16: Int16Array): string {
  const u8 = new Uint8Array(i16.buffer);
  // 分块拼接：一次 String.fromCharCode(...) 展开会在大数组上爆栈
  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < u8.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, u8.length);
    let piece = "";
    for (let j = i; j < end; j++) {
      piece += String.fromCharCode(u8[j]);
    }
    bin += piece;
  }
  return btoa(bin);
}

function b64DecodeI16(b64: string): Int16Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    u8[i] = bin.charCodeAt(i);
  }
  return new Int16Array(u8.buffer, 0, Math.floor(u8.length / 2));
}

/** 线性重采样：Safari 等不支持 16k AudioContext 时兜底 */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || input.length === 0) {
    return input;
  }
  const ratio = from / to;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/* ────────────────── 客户端 ────────────────── */

export class RealtimeVoiceClient {
  private ws: WebSocket | null = null;
  private cfg: SessionConfig | null = null;
  private cb: ClientCallbacks = {};

  private micCtx: AudioContext | null = null;
  private outCtx: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private micStream: MediaStream | null = null;
  private fileSource: AudioBufferSourceNode | null = null;

  /** 正在排队播放的 AI 语音源（打断时全部 stop） */
  private sources: AudioBufferSourceNode[] = [];
  private playCursor = 0;
  private tailTimer: ReturnType<typeof setTimeout> | null = null;

  private turns: Turn[] = [];
  private startedAt = 0;
  private speechStoppedAt = 0;
  private status: RealtimeStatus = "idle";
  private speaker: "agent" | "user" | null = null;

  private stats: RealtimeStats = {
    latency_samples: [],
    interruption_count: 0,
    audio_chunks: 0,
    audio_bytes: 0,
    events: {},
  };

  constructor(callbacks: ClientCallbacks = {}) {
    this.cb = callbacks;
  }

  /* ────── 生命周期 ────── */

  /**
   * 建立会话。
   * Promise 在「WebSocket 打开 + 音频就绪 + session.update 已下发」后 resolve；
   * 麦克风被拒 / 连接失败时 reject（UI 据此提示并留在开始页，而不是假装开始了）。
   */
  async start(cfg: SessionConfig, opts: { useTestAudio?: boolean } = {}): Promise<void> {
    this.stop();
    this.cfg = cfg;
    this.turns = [];
    this.startedAt = Date.now();
    this.speechStoppedAt = 0;
    this.stats = {
      latency_samples: [],
      interruption_count: 0,
      audio_chunks: 0,
      audio_bytes: 0,
      events: {},
    };

    const url = `${cfg.wsUrl}?model=${encodeURIComponent(cfg.model)}&api_key=${encodeURIComponent(cfg.apiKey)}`;
    this.setStatus("connecting");

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settleOk = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const settleFail = (message: string) => {
        if (settled) return;
        settled = true;
        this.fail(message);
        reject(new Error(message));
      };

      this.ws = new WebSocket(url);
      this.ws.onopen = async () => {
        try {
          await this.startAudio(opts.useTestAudio ?? false);
        } catch (error) {
          settleFail(
            `无法打开音频输入：${error instanceof Error ? error.message : String(error)}（请检查麦克风权限）`,
          );
          return;
        }

        this.outCtx = new AudioContext({ sampleRate: SAMPLE_RATE_OUT });
        void this.outCtx.resume();

        this.send({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            voice: cfg.voice,
            instructions: cfg.instructions,
            input_audio_format: "pcm",
            output_audio_format: "pcm",
            input_audio_transcription: { model: "qwen3-asr-flash-realtime" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 800,
              interrupt_response: true,
              create_response: true,
            },
            ...(cfg.session ?? {}),
          },
        });

        this.setStatus("live");

        // 让 AI 先开口。⚠️ 不带 instructions 的空 response.create 会被服务端拒绝
        // （实测返回 error：Cannot create response without input, history, or instructions）
        if (cfg.greeting) {
          this.send({ type: "response.create", response: { instructions: cfg.greeting } });
        }

        settleOk();
      };

      this.ws.onmessage = (ev) => {
        let data: any;
        try {
          data = JSON.parse(ev.data);
        } catch {
          return;
        }
        this.handleEvent(data);
      };

      this.ws.onerror = () => {
        this.setStatus("error", "连接出错");
        settleFail("无法连接语音服务，请检查网络后重试");
      };

      this.ws.onclose = (ev) => {
        if (!settled) {
          settleFail(
            ev.code === 1007
              ? "会话参数被服务端拒绝（code 1007，通常是 modalities 或音色不合法）"
              : `语音连接建立失败（code ${ev.code}）`,
          );
        } else {
          const detail =
            ev.code === 1007
              ? "会话参数被服务端拒绝（code 1007，通常是 modalities 或音色不合法）"
              : `连接已断开（code ${ev.code}）`;
          if (this.status === "live") {
            this.setStatus("closed", detail);
          }
        }
        this.cleanupAudio();
      };
    });
  }

  stop(): void {
    if (this.tailTimer) {
      clearTimeout(this.tailTimer);
      this.tailTimer = null;
    }
    try {
      if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
        this.ws.close();
      }
    } catch {
      /* 关闭失败无所谓 */
    }
    this.ws = null;
    this.cleanupAudio();
    if (this.status !== "idle") {
      this.setStatus("closed");
    }
  }

  /** 会话快照：供结束落库使用 */
  snapshot(): {
    turns: Turn[];
    duration: number;
    stats: RealtimeStats & { latency_avg: number; latency_max: number };
  } {
    const samples = this.stats.latency_samples;
    const avg = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
    const max = samples.length ? Math.max(...samples) : 0;

    return {
      turns: this.turns.map((t) => ({ ...t })),
      duration: this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0,
      stats: { ...this.stats, latency_avg: avg, latency_max: max },
    };
  }

  getStatus(): RealtimeStatus {
    return this.status;
  }

  /* ────── 音频上行 ────── */

  private createInContext(): AudioContext {
    try {
      return new AudioContext({ sampleRate: SAMPLE_RATE_IN });
    } catch {
      // Safari / 部分移动端不支持指定采样率 → 用默认采样率，采集后再重采样到 16k
      return new AudioContext();
    }
  }

  private async startAudio(useTestAudio: boolean): Promise<void> {
    const ctx = this.createInContext();
    this.micCtx = ctx;
    await ctx.resume();

    const blobUrl = URL.createObjectURL(
      new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
    );
    await ctx.audioWorklet.addModule(blobUrl);
    URL.revokeObjectURL(blobUrl);

    const worklet = new AudioWorkletNode(ctx, "pcm-capture");
    this.worklet = worklet;
    // 接一个增益为 0 的静音汇点：AudioWorklet 必须有下游才会被调度
    const sink = ctx.createGain();
    sink.gain.value = 0;
    worklet.connect(sink);
    sink.connect(ctx.destination);

    worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
      this.onFrame(event.data);
    };

    if (useTestAudio) {
      // 无头浏览器拿不到麦克风设备，用测试音频灌进同一个 AudioWorklet，
      // 下游（转码 / 上传 / 播放 / 打断）代码路径与真实麦克风完全一致。
      const res = await fetch("/test_audio_16k.wav");
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(worklet);
      src.start();
      this.fileSource = src;
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.micStream = stream;
    ctx.createMediaStreamSource(stream).connect(worklet);
  }

  private onFrame(raw: Float32Array): void {
    if (!this.micCtx) {
      return;
    }
    const f32 = resample(raw, this.micCtx.sampleRate, SAMPLE_RATE_IN);

    let sum = 0;
    const step = 8;
    let count = 0;
    for (let i = 0; i < f32.length; i += step) {
      sum += f32[i] * f32[i];
      count++;
    }
    const rms = count ? Math.sqrt(sum / count) : 0;
    this.cb.onLevel?.(rms);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const i16 = f32ToI16(f32);
      this.stats.audio_chunks++;
      this.stats.audio_bytes += i16.byteLength;
      this.send({ type: "input_audio_buffer.append", audio: b64Encode(i16) });
    }
    this.publishDebug();
  }

  private cleanupAudio(): void {
    try {
      this.fileSource?.stop();
    } catch {
      /* 已停止 */
    }
    try {
      this.worklet?.disconnect();
    } catch {
      /* 已断开 */
    }
    this.micStream?.getTracks().forEach((t) => t.stop());
    try {
      void this.micCtx?.close();
    } catch {
      /* 已关闭 */
    }
    this.stopPlayback(false);
    try {
      void this.outCtx?.close();
    } catch {
      /* 已关闭 */
    }
    this.fileSource = null;
    this.worklet = null;
    this.micStream = null;
    this.micCtx = null;
    this.outCtx = null;
  }

  /* ────── 音频下行 ────── */

  private playChunk(i16: Int16Array): number {
    const ctx = this.outCtx;
    if (!ctx) {
      return 0;
    }
    const buffer = ctx.createBuffer(1, i16.length, SAMPLE_RATE_OUT);
    buffer.copyToChannel(i16ToF32(i16), 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.02, this.playCursor);
    src.start(at);
    this.playCursor = at + buffer.duration;
    this.sources.push(src);
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
    };
    return at;
  }

  /** 打断：立刻停掉正在播放的 AI 语音 */
  private stopPlayback(countAsInterruption: boolean): void {
    if (countAsInterruption && this.sources.length > 0) {
      this.stats.interruption_count++;
    }
    for (const src of this.sources) {
      try {
        src.stop();
      } catch {
        /* 已停止 */
      }
    }
    this.sources = [];
    this.playCursor = 0;
  }

  /** 一轮结束后让缓冲区播完；真正的中断由 speech_started 触发 */
  private scheduleTailStop(): void {
    if (this.tailTimer) {
      clearTimeout(this.tailTimer);
    }
    const remain = this.playCursor - (this.outCtx ? this.outCtx.currentTime : 0);
    this.tailTimer = setTimeout(() => this.stopPlayback(false), Math.max(0, remain * 1000 + 200));
  }

  /* ────── 事件处理 ────── */

  private handleEvent(d: any): void {
    const type = d?.type;
    if (!type) {
      return;
    }
    this.stats.events[type] = (this.stats.events[type] || 0) + 1;

    switch (type) {
      // 服务端 VAD：用户开口 → 立刻闭嘴
      case "input_audio_buffer.speech_started":
        this.stopPlayback(true);
        this.setSpeaker("user");
        break;

      case "input_audio_buffer.speech_stopped":
        this.speechStoppedAt = performance.now();
        break;

      // ⚠️ 候选人转录：这是**累计**字段 text（不是增量 delta），stash 是"正在识别的半截话"
      case "conversation.item.input_audio_transcription.delta": {
        const id = d.item_id || "user-live";
        this.upsertTurn({
          id,
          role: "user",
          content: `${d.text || ""}${d.stash || ""}`,
          live: true,
        });
        break;
      }

      case "conversation.item.input_audio_transcription.completed": {
        const id = d.item_id || "user-live";
        this.upsertTurn({ id, role: "user", content: d.transcript || "", live: false });
        break;
      }

      // AI 回复文本：这里是**增量** delta
      case "response.audio_transcript.delta": {
        const id = d.item_id || d.response_id || "agent-live";
        this.appendTurn(id, d.delta || "");
        break;
      }

      case "response.audio_transcript.done": {
        const id = d.item_id || d.response_id || "agent-live";
        this.finalizeTurn(id);
        break;
      }

      // AI 语音（PCM 24k）
      case "response.audio.delta":
      case "response.output_audio.delta": {
        const i16 = b64DecodeI16(d.delta || "");
        const at = this.playChunk(i16);
        this.setSpeaker("agent");
        if (this.speechStoppedAt && this.outCtx) {
          const audibleAt = performance.now() + (at - this.outCtx.currentTime) * 1000;
          const latency = (audibleAt - this.speechStoppedAt) / 1000;
          this.stats.latency_samples.push(Number(latency.toFixed(2)));
          this.cb.onLatency?.(Number(latency.toFixed(2)));
          this.speechStoppedAt = 0;
        }
        break;
      }

      case "response.done":
        this.scheduleTailStop();
        break;

      case "error":
        this.cb.onError?.(d?.error?.message || "服务端返回错误");
        break;

      default:
        break;
    }

    this.publishDebug();
  }

  /* ────── 转录维护 ────── */

  private upsertTurn(turn: Omit<Turn, "offset_ms">): void {
    const existing = this.turns.find((t) => t.id === turn.id);
    if (existing) {
      existing.content = turn.content;
      existing.live = turn.live;
    } else {
      this.turns.push({ ...turn, offset_ms: Date.now() - this.startedAt });
    }
    this.emitTurns();
  }

  private appendTurn(id: string, delta: string): void {
    const existing = this.turns.find((t) => t.id === id);
    if (existing) {
      existing.content += delta;
      existing.live = true;
    } else {
      this.turns.push({
        id,
        role: "agent",
        content: delta,
        live: true,
        offset_ms: Date.now() - this.startedAt,
      });
    }
    this.emitTurns();
  }

  private finalizeTurn(id: string): void {
    const existing = this.turns.find((t) => t.id === id);
    if (existing) {
      existing.live = false;
      this.emitTurns();
    }
  }

  private emitTurns(): void {
    this.cb.onTurns?.(this.turns.map((t) => ({ ...t })));
  }

  /* ────── 状态 ────── */

  private send(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private setStatus(status: RealtimeStatus, detail?: string): void {
    this.status = status;
    this.cb.onStatus?.(status, detail);
  }

  private setSpeaker(speaker: "agent" | "user" | null): void {
    if (this.speaker === speaker) {
      return;
    }
    this.speaker = speaker;
    this.cb.onSpeaker?.(speaker);
  }

  private fail(message: string): void {
    this.setStatus("error", message);
    this.cb.onError?.(message);
    this.cleanupAudio();
    try {
      this.ws?.close();
    } catch {
      /* 已关闭 */
    }
    this.ws = null;
  }

  /** 自动化验证用的调试出口（无头浏览器里读它做断言） */
  private publishDebug(): void {
    if (typeof window === "undefined") {
      return;
    }
    const samples = this.stats.latency_samples;
    (window as unknown as Record<string, unknown>).__voiceDebug = {
      status: this.status,
      speaker: this.speaker,
      chunks: this.stats.audio_chunks,
      bytes: this.stats.audio_bytes,
      interruptions: this.stats.interruption_count,
      events: this.stats.events,
      latencies: samples,
      latencyAvg: samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0,
      turns: this.turns.map((t) => ({ ...t })),
    };
  }
}
