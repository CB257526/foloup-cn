"use client";

import { CheckCircle2, Loader2, RefreshCw, Volume2, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MIC_LEVEL_ACTIVE,
  MIC_REQUEST_TIMEOUT_MS,
  MIC_SAMPLE_MS,
  type MicFailure,
  buildDeviceGate,
  describeAudioContextUnsupported,
  describeMicError,
  describeNetworkFailure,
  levelText,
  levelToBar,
  requestMicStream,
  stopMediaStream,
} from "./preflight";

/**
 * 候选人设备预检（P2 后续任务新建）。
 *
 * 目标：把"点开始面试 → 一片沉默 / 报错"这种最伤体验的失败，提前到同意之前暴露出来，
 * 并且**每一种失败都告诉候选人下一步该做什么**（不允许只显示"出错了"）。
 *
 * 检查项与诚实边界：
 *   · 浏览器能力：getUserMedia / AudioContext 是否可用；
 *   · 麦克风：权限、设备是否存在、是否被占用，并实时显示电平（有可见反馈）；
 *   · 扬声器：**只能靠用户手势播一段测试音**，是否真的听见由候选人自己确认
 *     —— 浏览器无法替人判断"你有没有听到"；
 *   · 网络：真实请求本服务的一个只读探针接口，确认能连上面试服务；
 *   · 实时语音：**不建立真实 WebSocket 会话**（平台侧没有安全的空探针，且会产生计费/密钥分发），
 *     页面上明确写"实时连接将在开始面试时再次验证"，绝不用 HTTP 200 冒充 WebSocket 成功。
 *
 * 隐私：检查过程只在本机测量音量，**不录音、不上传、不保存任何音频**；
 *      采样结束立即释放麦克风（不长期占用设备）。
 */

export type DeviceCheckResult = {
  ready: boolean;
  blockedReason: string;
};

type MicState = "idle" | "checking" | "ok" | "failed";
type NetState = "idle" | "checking" | "ok" | "failed";
type SpeakerState = "idle" | "playing" | "played" | "unsupported";

type RealtimeInfo = { configured: boolean; model: string; note: string };

type Props = {
  /** 检查结论变化时回调（父组件据此禁用「同意并开始面试」） */
  onResultChange: (result: DeviceCheckResult) => void;
};

type AudioContextCtor = typeof AudioContext;

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

export function DeviceCheck({ onResultChange }: Props) {
  const [mic, setMic] = useState<{ state: MicState; failure?: MicFailure }>({ state: "idle" });
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const [audioOk, setAudioOk] = useState<boolean | null>(null);
  const [net, setNet] = useState<{ state: NetState; detail: string }>({
    state: "idle",
    detail: "尚未检查",
  });
  const [realtime, setRealtime] = useState<RealtimeInfo | null>(null);
  const [speaker, setSpeaker] = useState<SpeakerState>("idle");
  const [running, setRunning] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const heardRef = useRef(false);
  /** 防止卸载后回调继续改状态（React 会警告 + 泄漏 rAF） */
  const mountedRef = useRef(true);
  /**
   * 设备检查的代次。每点一次「开始检查 / 重新检查」+1，卸载也 +1。
   * 在途的异步结果（getUserMedia、rAF 采样）写回状态前都要先确认自己是"当前代次"，
   * 否则上一轮的迟到结果会把新一轮的检查结论覆盖掉。
   */
  const generationRef = useRef(0);

  /** 释放麦克风与音频上下文：检查一结束就放开设备，不长期占用（幂等，可重复调用） */
  const releaseAudio = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    // 释放麦克风轨道：不长期占用设备（否则正式面试时可能被判定为"设备被占用"）
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    if (ctxRef.current) {
      void ctxRef.current.close().catch(() => undefined);
      ctxRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      // 卸载即让当前代次作废：任何仍在途的 getUserMedia 结果回来时都会被就地释放，
      // 不会留下"没人管的麦克风占用"。
      generationRef.current += 1;
      releaseAudio();
    };
  }, [releaseAudio]);

  const checkNetwork = useCallback(async () => {
    if (!mountedRef.current) {
      return;
    }
    setNet({ state: "checking", detail: "正在检查网络连接…" });

    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (offline) {
      setNet({ state: "failed", detail: describeNetworkFailure(true) });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch("/api/realtime-preflight", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        realtime?: {
          configured?: boolean;
          model?: string;
          note?: string;
          unavailableReason?: string;
        };
      };
      const configured = Boolean(data?.realtime?.configured);

      if (!mountedRef.current) {
        return;
      }
      setRealtime({
        configured,
        model: String(data?.realtime?.model ?? ""),
        note: String(data?.realtime?.note ?? "实时连接将在开始面试时再次验证。"),
      });

      if (!configured) {
        setNet({
          state: "failed",
          detail:
            String(data?.realtime?.unavailableReason || "").trim() ||
            "服务端尚未配置语音服务，暂时无法开始面试。请联系招聘人员。",
        });
        return;
      }
      setNet({ state: "ok", detail: "网络正常，可以访问面试服务。" });
    } catch {
      if (mountedRef.current) {
        setNet({ state: "failed", detail: describeNetworkFailure(false) });
      }
    } finally {
      clearTimeout(timer);
    }
  }, []);

  const checkMic = useCallback(async () => {
    const generation = generationRef.current;
    /** 这一代是否已经作废（被新一轮检查顶掉，或组件已卸载） */
    const stale = () => !mountedRef.current || generationRef.current !== generation;

    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    const secureContext = typeof window === "undefined" ? true : window.isSecureContext;

    if (!media?.getUserMedia) {
      setMic({
        state: "failed",
        failure: describeMicError({ name: "NotSupportedError" }, { secureContext }),
      });
      return;
    }
    if (!secureContext) {
      // 内网 http:// 或 IP 直连时浏览器直接封死麦克风 —— 这是部署问题，必须说清楚
      setMic({ state: "failed", failure: describeMicError(null, { secureContext: false }) });
      return;
    }

    try {
      const devices = await media.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
      // 枚举设备也可能耗时；期间用户点了「重新检查」就不再往下走
      if (stale()) {
        return;
      }
      if (devices.length > 0 && !devices.some((device) => device.kind === "audioinput")) {
        setMic({ state: "failed", failure: describeMicError({ name: "NotFoundError" }) });
        return;
      }

      // 带代次的申请：超时 / 重新检查 / 卸载之后迟到的 MediaStream 会被就地 stop，
      // 既不会泄漏麦克风占用，也不会让旧结果覆盖新一轮的检查状态。
      const stream = await requestMicStream({
        request: () =>
          media.getUserMedia({
            audio: {
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          }),
        timeoutMs: MIC_REQUEST_TIMEOUT_MS,
        generation,
        generationRef,
        isAlive: () => mountedRef.current,
      });
      if (stale()) {
        stopMediaStream(stream);
        return;
      }
      streamRef.current = stream;

      const Ctor = getAudioContextCtor();
      if (!Ctor) {
        setMic({ state: "failed", failure: describeAudioContextUnsupported() });
        return;
      }

      let ctx: AudioContext;
      try {
        // 尽量用 16k（与上行采样率一致），Safari 不支持时退回默认采样率
        ctx = new Ctor({ sampleRate: 16000 });
      } catch {
        ctx = new Ctor();
      }
      ctxRef.current = ctx;
      await ctx.resume().catch(() => undefined);
      // 启动音频上下文期间可能被新一轮检查顶掉（那一轮会自行 close 本 ctx 并 stop 轨道）
      if (stale()) {
        return;
      }

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      const deadline = performance.now() + MIC_SAMPLE_MS;

      const tick = () => {
        if (stale() || !ctxRef.current) {
          return;
        }
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 1) {
          sum += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sum / buffer.length);

        setLevel(levelToBar(rms));
        if (rms >= MIC_LEVEL_ACTIVE) {
          heardRef.current = true;
          setHeard(true);
        }

        if (performance.now() < deadline) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        // 采样窗口结束：释放设备，保留结论
        releaseAudio();
        setLevel(0);
        setMic({ state: "ok" });
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch (error) {
      /*
       * 只有"这一代仍然有效"时才清理与改状态：
       *   · 代次已作废说明资源已经不归我们管（新一轮检查或卸载时已释放），
       *     此刻再调 releaseAudio() 反而会把新一轮正在用的麦克风/音频上下文关掉；
       *   · 迟到返回的流也已由 requestMicStream 就地 stop 过了。
       */
      if (stale()) {
        return;
      }
      releaseAudio();
      setMic({ state: "failed", failure: describeMicError(error, { secureContext }) });
    }
  }, [releaseAudio]);

  const runCheck = useCallback(async () => {
    // 让上一轮检查作废：它迟到的结果既不能覆盖新一轮状态，也不能继续占用麦克风
    generationRef.current += 1;
    setRunning(true);
    releaseAudio();
    heardRef.current = false;
    setHeard(false);
    setLevel(0);
    setSpeaker("idle");
    setMic({ state: "checking" });
    setNet({ state: "checking", detail: "正在检查网络连接…" });

    const audioSupported = Boolean(getAudioContextCtor());
    setAudioOk(audioSupported);

    await Promise.all([
      audioSupported
        ? checkMic()
        : Promise.resolve().then(() => {
            if (mountedRef.current) {
              setMic({ state: "failed", failure: describeAudioContextUnsupported() });
            }
          }),
      checkNetwork(),
    ]);

    if (mountedRef.current) {
      setRunning(false);
    }
  }, [checkMic, checkNetwork, releaseAudio]);

  /** 用真实用户手势播两短声：只有用户手势里的 AudioContext 才不会被浏览器静音 */
  const playTestTone = useCallback(async () => {
    const Ctor = getAudioContextCtor();
    if (!Ctor) {
      setSpeaker("unsupported");
      return;
    }
    try {
      setSpeaker("playing");
      const ctx = new Ctor();
      await ctx.resume().catch(() => undefined);
      const start = ctx.currentTime + 0.05;

      // 连续两声短音：是否真的听见由候选人自己确认（浏览器无法替人判断）
      for (const offset of [0, 0.5]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(660, start + offset);
        gain.gain.setValueAtTime(0.0001, start + offset);
        gain.gain.exponentialRampToValueAtTime(0.22, start + offset + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start + offset);
        osc.stop(start + offset + 0.32);
      }

      window.setTimeout(() => {
        void ctx.close().catch(() => undefined);
        if (mountedRef.current) {
          setSpeaker("played");
        }
      }, 1200);
    } catch {
      setSpeaker("unsupported");
    }
  }, []);

  const gate = buildDeviceGate({
    micOk: mic.state === "ok",
    micHint: mic.failure?.hint ?? "",
    audioContextOk: audioOk === true,
    networkOk: net.state === "ok",
  });

  // 用 ref 持有回调：父组件每次渲染都重建函数也不会导致重复上报
  const onResultRef = useRef(onResultChange);
  onResultRef.current = onResultChange;
  useEffect(() => {
    onResultRef.current({ ready: gate.ready, blockedReason: gate.blockedReason });
  }, [gate.ready, gate.blockedReason]);

  const micOk = mic.state === "ok";
  const micText =
    mic.state === "idle"
      ? "尚未检查"
      : mic.state === "checking"
        ? levelText("checking", heard)
        : mic.state === "ok"
          ? levelText("ok", heard)
          : (mic.failure?.message ?? "检查未通过");

  return (
    <div
      data-testid="device-check"
      className="mt-4 min-w-0 rounded-lg border border-indigo-100 bg-white p-4"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-gray-900">设备检查</h3>
          <p className="mt-1 break-words text-xs leading-relaxed text-gray-600">
            检查过程只在本机测量音量，<strong>不会录音、不会上传、不会保存音频</strong>；
            检查结束会立刻释放麦克风。请对着麦克风说几句话。
          </p>
        </div>
        <button
          type="button"
          data-testid="device-check-run"
          onClick={() => void runCheck()}
          disabled={running}
          className="inline-flex h-10 w-full shrink-0 items-center justify-center rounded-lg border-2 border-indigo-600 bg-white px-4 text-sm font-semibold text-indigo-700 disabled:opacity-60 sm:w-auto"
        >
          {running ? (
            <Loader2 size={16} className="mr-2 animate-spin" />
          ) : (
            <RefreshCw size={16} className="mr-2" />
          )}
          {running ? "正在检查…" : mic.state === "idle" ? "开始设备检查" : "重新检查"}
        </button>
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        {/* ── 麦克风 ── */}
        <div className="min-w-0 rounded-md bg-slate-50 p-3">
          <div className="flex min-w-0 items-start gap-2">
            <StatusIcon state={mic.state} ok={micOk} />
            <div className="min-w-0 flex-1">
              <dt className="font-semibold text-gray-800">麦克风</dt>
              <dd
                data-testid="device-check-mic-status"
                className="mt-0.5 break-words text-gray-700"
              >
                {micText}
              </dd>
              {mic.state !== "idle" && (
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full bg-indigo-500 transition-[width] duration-75"
                    style={{ width: `${Math.round(level * 100)}%` }}
                  />
                </div>
              )}
              {mic.state === "ok" && !heard && (
                <p className="mt-2 break-words text-xs leading-relaxed text-amber-700">
                  没有检测到明显声音：请确认麦克风没有被静音、也没有离得太远。正式面试时请对着麦克风正常说话。
                </p>
              )}
              {mic.state === "failed" && mic.failure && (
                <p className="mt-2 break-words text-xs leading-relaxed text-red-700">
                  下一步：{mic.failure.hint}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── 扬声器 ── */}
        <div className="min-w-0 rounded-md bg-slate-50 p-3">
          {/*
            这一行允许换行（flex-wrap）：窄屏上「播放测试音」按钮会整行落到下一行，
            否则按钮以 shrink-0 参与同一行布局，会把左侧说明文字挤到 0 宽（变成一字一行）。
          */}
          <div className="flex min-w-0 flex-wrap items-start gap-2">
            <StatusIcon
              state={speaker === "unsupported" ? "failed" : speaker === "idle" ? "idle" : "ok"}
              ok={speaker === "played"}
            />
            <div className="min-w-0 flex-1">
              <dt className="font-semibold text-gray-800">扬声器 / 耳机</dt>
              <dd data-testid="device-check-speaker" className="mt-0.5 break-words text-gray-700">
                {speaker === "idle"
                  ? "尚未测试（可点右侧按钮播放一段测试音）"
                  : speaker === "playing"
                    ? "正在播放测试音…"
                    : speaker === "played"
                      ? "已播放测试音。如果你听到了两声「嘟」，说明能正常听到面试官说话。"
                      : "此浏览器无法完成扬声器测试。"}
              </dd>
              {speaker === "unsupported" && (
                <p className="mt-2 break-words text-xs leading-relaxed text-amber-700">
                  下一步：无法自动测试扬声器，请在开始面试后确认能听到面试官的声音；听不到就调高音量或换用耳机。
                </p>
              )}
              {speaker === "played" && (
                <p className="mt-2 break-words text-xs leading-relaxed text-gray-600">
                  没有听到声音？请调高音量、确认没有静音，或换用耳机。
                </p>
              )}
            </div>
            <button
              type="button"
              data-testid="device-check-speaker-play"
              onClick={() => void playTestTone()}
              disabled={speaker === "playing"}
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-indigo-300 bg-white px-3 text-xs font-semibold text-indigo-700 disabled:opacity-60"
            >
              <Volume2 size={14} className="mr-1" />
              播放测试音
            </button>
          </div>
        </div>

        {/* ── 网络 ── */}
        <div className="min-w-0 rounded-md bg-slate-50 p-3">
          <div className="flex min-w-0 items-start gap-2">
            <StatusIcon state={net.state} ok={net.state === "ok"} />
            <div className="min-w-0 flex-1">
              <dt className="font-semibold text-gray-800">网络</dt>
              <dd
                data-testid="device-check-network-status"
                className="mt-0.5 break-words text-gray-700"
              >
                {net.detail}
              </dd>
              {net.state === "failed" && (
                <p className="mt-2 break-words text-xs leading-relaxed text-red-700">
                  下一步：按上面的提示处理，然后点「重新检查」。如果一直失败，请稍后再试或联系招聘人员。
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── 实时语音（诚实标注：这里没有建立真实连接） ── */}
        <div className="min-w-0 rounded-md bg-amber-50 p-3">
          <div className="flex min-w-0 items-start gap-2">
            <StatusIcon state="idle" ok={false} />
            <div className="min-w-0 flex-1">
              <dt className="font-semibold text-gray-800">实时语音连接</dt>
              <dd data-testid="device-check-realtime" className="mt-0.5 break-words text-gray-700">
                {realtime === null
                  ? "将在设备检查时确认服务端配置状态。"
                  : realtime.configured
                    ? `服务端已配置语音服务（模型：${realtime.model || "默认"}）。`
                    : "服务端尚未配置语音服务，暂时无法开始面试。"}
              </dd>
              <p className="mt-2 break-words text-xs leading-relaxed text-amber-800">
                {realtime?.note || "实时连接将在开始面试时再次验证。"}
                {realtime?.configured
                  ? "这里没有建立真实语音连接（预检不会占用你的专属链接，也不会产生面试记录）；如果开始面试时连接失败，页面会给出重试入口。"
                  : ""}
              </p>
            </div>
          </div>
        </div>
      </dl>

      <p
        data-testid="device-check-summary"
        className={`mt-3 break-words rounded-md p-3 text-sm font-semibold ${
          gate.ready ? "bg-green-50 text-green-800" : "bg-gray-100 text-gray-700"
        }`}
      >
        {running
          ? "设备检查进行中…"
          : gate.ready
            ? "设备检查已通过 ✓ 可以继续下一步。"
            : "设备检查尚未通过 —— 通过后才能开始面试。"}
      </p>
    </div>
  );
}

function StatusIcon({ state, ok }: { state: MicState | NetState | SpeakerState; ok: boolean }) {
  if (state === "checking" || state === "playing") {
    return <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-indigo-500" />;
  }
  if (state === "ok" || ok) {
    return <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-600" />;
  }
  if (state === "failed") {
    return <XCircle size={18} className="mt-0.5 shrink-0 text-red-500" />;
  }

  return <span className="mt-1.5 block h-3 w-3 shrink-0 rounded-full bg-gray-300" />;
}
