"use client";

import { FeedbackForm } from "@/components/call/feedbackForm";
import {
  type RealtimeStatus,
  RealtimeVoiceClient,
  appendRealtimeDebugEvent,
  type Turn,
} from "@/components/call/realtimeClient";
import { TabSwitchWarning, useTabSwitchPrevention } from "@/components/call/tabSwitchPrevention";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DEFAULT_INTERVIEW_DURATION_MINUTES, normalizeInterviewDuration } from "@/lib/constants";
import { isLightColor, testEmail } from "@/lib/utils";
import { FeedbackService } from "@/services/feedback.service";
import { InterviewerService } from "@/services/interviewers.service";
import { ResponseService } from "@/services/responses.service";
import type { PublicCandidateInvite } from "@/types/candidate";
import type { Interview } from "@/types/interview";
import type {
  CallData,
  CallEndReason,
  CallSessionFinishResult,
  FeedbackData,
  TranscriptTurn,
} from "@/types/response";
import axios from "axios";
import {
  AlarmClockIcon,
  ArrowUpRightSquareIcon,
  Camera,
  CheckCircleIcon,
  Loader2,
  Mic,
  X,
  XCircleIcon,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import MiniLoader from "../loaders/mini-loader/miniLoader";
import { Button } from "../ui/button";
import { Card, CardHeader, CardTitle } from "../ui/card";

/* ══════════════════ 对外接口（已冻结，P3 依此做手机端与合规） ══════════════════
 *
 *   <Call interview={interview} />
 *
 *   - 默认导出，必须是**客户端组件**（要用麦克风 / WebSocket / AudioContext）
 *   - props 只有一个必填项：`interview: Interview`（与改造前完全一致，P3 的页面不用改）
 *   - 不直接连数据库：转录与时长通过 Server Action（ResponseService）落库
 *   - 调试用 URL 参数（仅自动化验证使用，正常访问不受影响）：
 *       ?voiceInput=file  用 /test_audio_16k.wav 代替麦克风（无头浏览器没有音频设备）
 *       ?autostart=1      进页面即自动开始（配合 ?email= / ?name= 使用）
 *   - 调试出口：window.__voiceDebug（状态 / 转录 / 延迟 / 上行音频统计）
 * ═════════════════════════════════════════════════════════════════════════════ */

type CallProps = {
  interview: Interview;
  /** 候选人专属邀请通过不可猜测的令牌传入，旧岗位公共页面不提供该字段。 */
  candidate?: PublicCandidateInvite & { token: string };
};

/** `POST /api/register-call` 的返回：签发一次实时语音会话所需的全部参数 */
type RegisterCallResponse = {
  callId: string;
  wsUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  instructions: string;
  greeting: string;
  session?: Record<string, unknown>;
};

type ProctorSessionConfig = {
  enabled: boolean;
  token: string;
  intervalSeconds: number;
  confidenceThreshold: number;
};

type PermissionState = "loading" | "needed" | "requesting" | "granted" | "failed" | "not_required";

type ProctorDebugMetrics = {
  enabled: boolean;
  captureCount: number;
  skippedInFlightCount: number;
  failureCount: number;
  lastCaptureAt: number | null;
  lastDrawMs: number | null;
  maxDrawMs: number;
  lastEncodeMs: number | null;
  maxEncodeMs: number;
  lastUploadMs: number | null;
  maxUploadMs: number;
  lastImageBytes: number | null;
  longTaskCount: number;
  maxLongTaskMs: number;
};

type VoiceDebugSnapshot = {
  diagnosticEvents?: Array<{ atMs: number; type: string; valueMs?: number; detail?: string }>;
  voice?: {
    audioDeltaCount: number;
    audioDeltaGapCount: number;
    audioDeltaGapOver150MsCount: number;
    audioDeltaGapAvgMs: number;
    audioDeltaGapMaxMs: number;
    lastAudioDeltaGapMs: number | null;
    lastAudioDeltaAgeMs: number | null;
    lastChunkDurationMs: number | null;
    currentQueueMs: number;
    minQueueMs: number | null;
    maxQueueMs: number;
    queueUnderrunCount: number;
    speechStartedCount: number;
    speechStartedWhilePlayingCount: number;
    audioContextState: string;
  };
  proctor?: ProctorDebugMetrics;
};

function permissionStateText(state: PermissionState): string {
  switch (state) {
    case "loading":
      return "正在检查";
    case "requesting":
      return "正在请求权限";
    case "granted":
      return "已就绪";
    case "failed":
      return "需要重新授权";
    case "not_required":
      return "当前未启用";
    default:
      return "未授权";
  }
}

function PermissionCard({
  icon,
  title,
  description,
  actionLabel,
  state,
  error,
  onRequest,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  state: PermissionState;
  error?: string;
  onRequest: () => void;
}) {
  const ready = state === "granted";
  const unavailable = state === "not_required";
  const requesting = state === "requesting";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm">
      <div className="flex items-start gap-3">
        <div
          className={`rounded-lg p-2 ${ready ? "bg-emerald-50 text-emerald-600" : "bg-indigo-50 text-indigo-600"}`}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-slate-800">{title}</p>
            <span
              className={`shrink-0 text-xs font-semibold ${ready ? "text-emerald-600" : unavailable ? "text-slate-400" : "text-amber-600"}`}
            >
              {ready && <CheckCircleIcon className="mr-1 inline-block" size={14} />}
              {permissionStateText(state)}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
          {error && <p className="mt-2 text-xs leading-5 text-red-600">{error}</p>}
          <button
            type="button"
            onClick={onRequest}
            disabled={ready || unavailable || requesting || state === "loading"}
            className="mt-3 inline-flex h-9 items-center justify-center rounded-lg border border-indigo-200 px-3 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {requesting && <Loader2 className="mr-1.5 animate-spin" size={15} />}
            {ready
              ? "已完成授权"
              : requesting
                ? "请求中"
                : state === "failed"
                  ? "重新授权"
                  : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function readVoiceDebug(): VoiceDebugSnapshot {
  if (typeof window === "undefined") return {};
  return (window as unknown as { __voiceDebug?: VoiceDebugSnapshot }).__voiceDebug ?? {};
}

function DebugMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-2 py-1">
      <span className="text-slate-500">{label}</span>
      <strong className="ml-1 text-slate-800">{value}</strong>
    </div>
  );
}

/**
 * 监考提醒条（黄色横幅）。
 *
 * 🔴 为什么要给候选人一个「收起当前这条」的按钮：
 *   这些提醒是**持续显示**的 —— 只有下一次画面分析明确返回 `clear` 时才会自动清空，
 *   一旦出现就会一直挂在页面上（手机端窄屏更挡内容），而候选人此前没有任何收起它的手段。
 *
 * ⚠️ 关闭按钮只收起这条**提示文案**，不改变任何监考行为：
 *   截图仍按间隔采集、风险事件仍上报、strike 计数与上限判定仍在服务端照常累加；
 *   下一次分析若再判定出风险事件，提醒会重新出现。
 */
function ProctorNotice({
  text,
  onDismiss,
  className = "",
}: {
  text: string;
  onDismiss: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-normal leading-6 text-amber-900 ${className}`}
    >
      {/* 用 <output> 承载 status 语义（它本身就是 role="status"），
          关闭按钮放在它外面 —— 按钮不该被当成状态播报内容的一部分。 */}
      <output className="min-w-0 flex-1 [overflow-wrap:anywhere]">{text}</output>
      <button
        type="button"
        aria-label="收起这条提醒"
        title="收起"
        onClick={onDismiss}
        className="-mt-0.5 -mr-1 shrink-0 rounded p-1 text-amber-700 transition-colors hover:bg-amber-100 hover:text-amber-900"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

const STATUS_TEXT: Record<RealtimeStatus, string> = {
  idle: "未连接",
  connecting: "正在连接语音服务…",
  live: "对话进行中",
  closed: "连接已断开",
  error: "连接异常",
};

const END_REASON_TEXT: Record<CallEndReason, string> = {
  candidate_ended: "候选人主动结束",
  time_up: "到达面试时长上限",
  connection_closed: "语音连接中断",
  proctoring_terminated: "因监考规则强制结束",
  error: "通话异常结束",
};

const PROCTOR_EVENT_TEXT: Record<string, string> = {
  phone: "疑似手机或平板入镜",
  absent: "候选人暂时离开画面",
  multiple_people: "检测到多人入镜",
  looking_away: "检测到频繁看向屏幕外",
};

/**
 * 连接层在极端网络环境下可能既不 open 也不 error，不能让候选人页面永久停在加载态。
 * 超时只负责终止浏览器等待，不会创建 response 记录，也不会伪造 started_at。
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function Call({ interview, candidate }: CallProps) {
  /* ── 表单与流程状态 ── */
  const [Loading, setLoading] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [isEnded, setIsEnded] = useState(false);
  const [email, setEmail] = useState<string>(candidate?.email ?? "");
  const [name, setName] = useState<string>(candidate?.name ?? "");
  const [isValidEmail, setIsValidEmail] = useState<boolean>(
    Boolean(candidate?.email && testEmail(candidate.email)),
  );
  const [isOldUser, setIsOldUser] = useState<boolean>(false);
  const [isFeedbackSubmitted, setIsFeedbackSubmitted] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [interviewerImg, setInterviewerImg] = useState("");
  const [finalSession, setFinalSession] = useState<CallSessionFinishResult | null>(null);
  const [interviewTimeDuration, setInterviewTimeDuration] = useState<string>(
    String(DEFAULT_INTERVIEW_DURATION_MINUTES),
  );

  /* ── 通话状态 ── */
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [statusDetail, setStatusDetail] = useState<string>("");
  const [speaker, setSpeaker] = useState<"agent" | "user" | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [level, setLevel] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [proctorNotice, setProctorNotice] = useState("");
  const [proctoringEnabled, setProctoringEnabled] = useState<boolean | null>(null);
  const [permissionConfigLoaded, setPermissionConfigLoaded] = useState(false);
  const [cameraPermission, setCameraPermission] = useState<PermissionState>("loading");
  const [microphonePermission, setMicrophonePermission] = useState<PermissionState>("needed");
  const [cameraPermissionError, setCameraPermissionError] = useState("");
  const [microphonePermissionError, setMicrophonePermissionError] = useState("");
  const [useTestAudio, setUseTestAudio] = useState(false);
  const [voiceDebugEnabled, setVoiceDebugEnabled] = useState(false);
  const [voiceDebug, setVoiceDebug] = useState<VoiceDebugSnapshot>({});

  const clientRef = useRef<RealtimeVoiceClient | null>(null);
  const callIdRef = useRef<string>("");
  const analysisTokenRef = useRef<string>("");
  const sessionMetaRef = useRef<{ model: string; voice: string }>({ model: "", voice: "" });
  const savedRef = useRef(false);
  const endedRef = useRef(false);
  const isStartedRef = useRef(false);
  const sessionStartPerfRef = useRef<number | null>(null);
  const sessionDurationMsRef = useRef<number | null>(null);
  const useTestAudioRef = useRef(false);
  const autoStartRef = useRef(false);
  const startConversationRef =
    useRef<(override?: { email?: string; name?: string }) => Promise<void>>();
  const lastUserResponseRef = useRef<HTMLDivElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null);
  const proctorVideoRef = useRef<HTMLVideoElement | null>(null);
  const proctorSessionRef = useRef<ProctorSessionConfig | null>(null);
  const proctorInFlightRef = useRef(false);
  const proctorTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const proctorDebugRef = useRef<ProctorDebugMetrics>({
    enabled: false,
    captureCount: 0,
    skippedInFlightCount: 0,
    failureCount: 0,
    lastCaptureAt: null,
    lastDrawMs: null,
    maxDrawMs: 0,
    lastEncodeMs: null,
    maxEncodeMs: 0,
    lastUploadMs: null,
    maxUploadMs: 0,
    lastImageBytes: null,
    longTaskCount: 0,
    maxLongTaskMs: 0,
  });

  const { tabSwitchCount } = useTabSwitchPrevention();
  const tabSwitchRef = useRef(0);
  tabSwitchRef.current = tabSwitchCount;

  useEffect(() => {
    isStartedRef.current = isStarted;
  }, [isStarted]);

  /* ── 音频来源：默认麦克风；?voiceInput=file 时用测试音频（自动化验证用） ── */
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const testAudioEnabled = qs.get("voiceInput") === "file";
    useTestAudioRef.current = testAudioEnabled;
    setUseTestAudio(testAudioEnabled);
    autoStartRef.current = qs.get("autostart") === "1";
    setVoiceDebugEnabled(qs.get("voiceDebug") === "1");
  }, []);

  useEffect(() => {
    if (!voiceDebugEnabled) return;
    const observer =
      "PerformanceObserver" in window
        ? new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const duration = Number(entry.duration.toFixed(1));
              proctorDebugRef.current.longTaskCount += 1;
              proctorDebugRef.current.maxLongTaskMs = Math.max(
                proctorDebugRef.current.maxLongTaskMs,
                duration,
              );
              appendRealtimeDebugEvent({
                atMs: Number(performance.now().toFixed(1)),
                type: "long_task",
                valueMs: duration,
                detail: `主线程长任务 ${duration.toFixed(1)}ms`,
              });
            }
          })
        : null;
    try {
      observer?.observe({ type: "longtask", buffered: true });
    } catch {
      // 部分浏览器不支持 longtask 类型，其他监控仍然有效。
    }
    const timer = window.setInterval(() => {
      const clientMetrics = clientRef.current?.getDebugMetrics();
      const current = readVoiceDebug();
      setVoiceDebug({
        ...current,
        voice: clientMetrics ?? current.voice,
        proctor: { ...proctorDebugRef.current },
      });
    }, 500);
    return () => {
      observer?.disconnect();
      window.clearInterval(timer);
    };
  }, [voiceDebugEnabled]);

  useEffect(() => {
    let cancelled = false;
    void axios
      .get<{ enabled: boolean }>("/api/proctor/config")
      .then(({ data }) => {
        if (cancelled) return;
        setPermissionConfigLoaded(true);
        setProctoringEnabled(data.enabled);
        setCameraPermission(data.enabled ? "needed" : "not_required");
      })
      .catch(() => {
        if (cancelled) return;
        setProctorNotice("暂时无法读取摄像头监考设置，请刷新页面后重试。");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!autoStartRef.current) {
      return;
    }
    const qs = new URLSearchParams(window.location.search);
    const timer = setTimeout(() => {
      void startConversationRef.current?.({
        email: qs.get("email") || "p1-test@example.com",
        name: qs.get("name") || "测试候选人",
      });
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (testEmail(email)) {
      setIsValidEmail(true);
    }
  }, [email]);

  useEffect(() => {
    // 历史岗位可能没有时长，候选人端必须使用和后台一致的 20 分钟安全默认值。
    setInterviewTimeDuration(normalizeInterviewDuration(interview?.time_duration));
  }, [interview]);

  useEffect(() => {
    const fetchInterviewer = async () => {
      // 门面层编译期声明为非空，但查不到时运行时会返回 null —— 这里必须判空
      const interviewer = await InterviewerService.getPublicInterviewer(interview.interviewer_id);
      setInterviewerImg(interviewer?.image ?? "");
    };
    fetchInterviewer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interview.interviewer_id]);

  // 候选人侧文本变化 → 自动滚到底
  useEffect(() => {
    if (turns.length > 0 && lastUserResponseRef.current) {
      lastUserResponseRef.current.scrollTop = lastUserResponseRef.current.scrollHeight;
    }
  }, [turns]);

  /* ── 计时与超时自动结束 ── */
  useEffect(() => {
    if (!isStarted || isEnded) {
      return;
    }
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);

    return () => clearInterval(id);
  }, [isStarted, isEnded]);

  useEffect(() => {
    const limit = Number(interviewTimeDuration) * 60;
    const serverDurationMs = sessionDurationMsRef.current;
    const sessionStartPerf = sessionStartPerfRef.current;
    const isServerExpired =
      serverDurationMs !== null && sessionStartPerf !== null
        ? performance.now() - sessionStartPerf >= serverDurationMs
        : limit > 0 && elapsed >= limit;
    if (isStarted && !isEnded && isServerExpired) {
      void finishCall("time_up");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, isStarted, isEnded, interviewTimeDuration]);

  const stopProctoring = () => {
    if (proctorTimerRef.current) {
      clearInterval(proctorTimerRef.current);
      proctorTimerRef.current = null;
    }
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    microphoneStreamRef.current = null;
    proctorSessionRef.current = null;
    setCameraStream(null);
    setCameraPermission(proctoringEnabled ? "needed" : "not_required");
    setMicrophonePermission("needed");
    if (proctorVideoRef.current) proctorVideoRef.current.srcObject = null;
    if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = null;
  };

  const requestCameraPermission = async () => {
    if (Loading || cameraPermission === "requesting" || cameraPermission === "granted") return;
    setCameraPermission("requesting");
    setCameraPermissionError("");
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraStream(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("当前浏览器不支持摄像头，请使用 HTTPS 页面或更新浏览器。");
      }
      /**
       * 🔴 必须显式指定 `facingMode`：手机浏览器在未指定朝向时按平台默认选择摄像头，
       *    Android / iOS 的默认都是**后置**（environment）摄像头 —— 候选人拿到的会是拍环境的那个，
       *    监考截图里只有对面的墙，看不到人脸。
       *
       * 用 `{ ideal: "user" }` 而不是 `"user"`：`"user"` 是**强制**约束，
       *    设备若没有前置摄像头会直接抛 `OverconstrainedError`，导致候选人根本开不了摄像头；
       *    `ideal` 是「优先前置，没有则回落后置」，在手机上（都有前置）效果相同，但不会硬失败。
       */
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 5, max: 10 },
        },
      });
      cameraStreamRef.current = stream;
      setCameraStream(stream);
      setCameraPermission("granted");
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          setCameraPermission("failed");
          setProctorNotice("摄像头已关闭或连接中断，请重新授权后再开始面试。");
        });
      });
    } catch (error) {
      setCameraPermission("failed");
      setCameraPermissionError(
        error instanceof Error ? error.message : "无法访问摄像头，请检查浏览器权限和摄像头设备。",
      );
    }
  };

  const requestMicrophonePermission = async () => {
    if (Loading || microphonePermission === "requesting" || microphonePermission === "granted")
      return;
    setMicrophonePermission("requesting");
    setMicrophonePermissionError("");
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneStreamRef.current = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("当前浏览器不支持麦克风，请使用 HTTPS 页面或更新浏览器。");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      microphoneStreamRef.current = stream;
      setMicrophonePermission("granted");
      stream.getAudioTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          if (microphoneStreamRef.current === stream) setMicrophonePermission("failed");
        });
      });
    } catch (error) {
      setMicrophonePermission("failed");
      setMicrophonePermissionError(
        error instanceof Error ? error.message : "无法访问麦克风，请检查浏览器权限和设备。",
      );
    }
  };

  const mediaPermissionsReady =
    permissionConfigLoaded &&
    (proctoringEnabled ? cameraPermission === "granted" : true) &&
    (useTestAudio || microphonePermission === "granted");

  const captureProctorFrame = async () => {
    const session = proctorSessionRef.current;
    const video = proctorVideoRef.current;
    if (!session?.enabled || !session.token || !video) return;
    if (proctorInFlightRef.current) {
      proctorDebugRef.current.skippedInFlightCount += 1;
      return;
    }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth < 1) return;

    proctorInFlightRef.current = true;
    let uploadStartedAt = 0;
    try {
      const canvas = captureCanvasRef.current || document.createElement("canvas");
      captureCanvasRef.current = canvas;
      const targetWidth = Math.min(640, video.videoWidth);
      const targetHeight = Math.max(
        1,
        Math.round((video.videoHeight / video.videoWidth) * targetWidth),
      );
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("无法读取摄像头画面。");
      const drawStartedAt = performance.now();
      context.drawImage(video, 0, 0, targetWidth, targetHeight);
      const drawMs = Number((performance.now() - drawStartedAt).toFixed(1));
      const encodeStartedAt = performance.now();
      const imageDataUrl = canvas.toDataURL("image/jpeg", 0.62);
      const encodeMs = Number((performance.now() - encodeStartedAt).toFixed(1));
      const imageBytes = Math.max(0, Math.round((imageDataUrl.length * 3) / 4));
      proctorDebugRef.current = {
        ...proctorDebugRef.current,
        enabled: true,
        captureCount: proctorDebugRef.current.captureCount + 1,
        lastCaptureAt: Date.now(),
        lastDrawMs: drawMs,
        maxDrawMs: Math.max(proctorDebugRef.current.maxDrawMs, drawMs),
        lastEncodeMs: encodeMs,
        maxEncodeMs: Math.max(proctorDebugRef.current.maxEncodeMs, encodeMs),
        lastImageBytes: imageBytes,
      };
      appendRealtimeDebugEvent({
        atMs: Number(performance.now().toFixed(1)),
        type: "screenshot_encode",
        valueMs: encodeMs,
        detail: `截图编码 ${encodeMs.toFixed(1)}ms，约 ${imageBytes} 字节`,
      });
      const snapshot = clientRef.current?.snapshot();
      const transcript = (snapshot?.turns ?? []).map((turn) => ({
        role: turn.role,
        content: turn.content,
        offset_ms: turn.offset_ms,
      }));
      uploadStartedAt = performance.now();
      const response = await axios.post("/api/proctor/analyze", {
        callId: callIdRef.current,
        token: session.token,
        imageDataUrl,
        transcript,
      });
      const result = response.data as {
        event?: { type: string; summary: string } | null;
        strikeCount?: number;
        maxStrikes?: number;
        terminated?: boolean;
        consecutiveFailures?: number;
        status?: string;
      };
      if (result.event && result.strikeCount) {
        const label = PROCTOR_EVENT_TEXT[result.event.type] || "监考风险";
        setProctorNotice(
          `监考提醒 ${result.strikeCount}/${result.maxStrikes ?? 3}：${label}。${result.event.summary}`,
        );
        toast.warning(`监考提醒 ${result.strikeCount}/${result.maxStrikes ?? 3}`, {
          description: `${label}：${result.event.summary}`,
          duration: 8000,
        });
      } else if (result.status === "clear") {
        setProctorNotice("");
      }
      if ((result.consecutiveFailures ?? 0) === 3) {
        setProctorNotice(
          "视觉分析暂不可用，截图已保存，面试会继续进行，相关记录将由招聘人员人工复核。",
        );
      }
      if (result.terminated) {
        setProctorNotice("累计监考风险事件已达到上限，本场面试已结束。");
        await finishCall("proctoring_terminated");
      }
    } catch (error) {
      const statusCode = axios.isAxiosError(error) ? error.response?.status : undefined;
      const message = axios.isAxiosError(error)
        ? typeof error.response?.data?.error === "string"
          ? error.response.data.error
          : error.message
        : error instanceof Error
          ? error.message
          : "";
      // 面试结束时可能还有一次截图请求在收尾，不应把服务端拒绝采集当成视觉故障提示。
      if (statusCode === 400 && message.includes("面试已经结束")) {
        return;
      }
      proctorDebugRef.current.failureCount += 1;
      if (statusCode !== 429) {
        console.error(
          "摄像头截图分析失败：",
          error instanceof Error ? error.message : String(error),
        );
        setProctorNotice("摄像头截图暂时无法分析，面试会继续进行；请保持摄像头开启。");
      }
    } finally {
      if (uploadStartedAt > 0) {
        const uploadMs = Number((performance.now() - uploadStartedAt).toFixed(1));
        proctorDebugRef.current.lastUploadMs = uploadMs;
        proctorDebugRef.current.maxUploadMs = Math.max(
          proctorDebugRef.current.maxUploadMs,
          uploadMs,
        );
        appendRealtimeDebugEvent({
          atMs: Number(performance.now().toFixed(1)),
          type: "screenshot_upload",
          valueMs: uploadMs,
          detail: `截图请求耗时 ${uploadMs.toFixed(1)}ms`,
        });
      }
      proctorInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (!isStarted || isEnded || !proctorSessionRef.current?.enabled) return;
    const interval = Math.max(5, proctorSessionRef.current.intervalSeconds) * 1000;
    void captureProctorFrame();
    proctorTimerRef.current = setInterval(() => void captureProctorFrame(), interval);
    return () => {
      if (proctorTimerRef.current) clearInterval(proctorTimerRef.current);
      proctorTimerRef.current = null;
    };
  }, [isStarted, isEnded]);

  useEffect(() => {
    if (!cameraStream) return;
    if (proctorVideoRef.current) proctorVideoRef.current.srcObject = cameraStream;
    if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = cameraStream;
    void cameraPreviewRef.current?.play().catch(() => {
      setProctorNotice("摄像头预览未能自动播放，但截图监考仍会尝试继续。");
    });
    void proctorVideoRef.current?.play().catch(() => undefined);
  }, [cameraStream]);

  const handleFeedbackSubmit = async (formData: Omit<FeedbackData, "interview_id">) => {
    try {
      const result = await FeedbackService.submitFeedback({
        ...formData,
        interview_id: interview.id,
      });

      if (result) {
        toast.success("感谢你的反馈！");
        setIsFeedbackSubmitted(true);
        setIsDialogOpen(false);
      } else {
        toast.error("反馈提交失败，请重试。");
      }
    } catch (error) {
      console.error("Error submitting feedback:", error);
      toast.error("出错了，请稍后再试。");
    }
  };

  /**
   * 结束通话：先停止浏览器音频，再把客户端快照作为诊断输入提交给服务端。
   * ended_at、server_duration 和 details 的最终时间字段全部由服务端生成。
   */
  const finishCall = async (reason: CallEndReason) => {
    if (endedRef.current) {
      return;
    }
    endedRef.current = true;

    const client = clientRef.current;
    const snapshot = client?.snapshot();

    const callId = callIdRef.current;
    if (callId && !savedRef.current) {
      const transcriptObject: TranscriptTurn[] = (snapshot?.turns ?? []).map((t) => ({
        role: t.role,
        content: t.content,
        offset_ms: t.offset_ms,
      }));
      const speakerName = name || "候选人";
      const transcriptText = transcriptObject
        .map((t) => `${t.role === "agent" ? "AI 面试官" : speakerName}：${t.content}`)
        .join("\n\n");
      const clientDuration = Math.round(snapshot?.duration ?? elapsed);

      const details: CallData = {
        call_id: callId,
        interview_id: interview.id,
        model: sessionMetaRef.current.model,
        voice: sessionMetaRef.current.voice,
        transcript: transcriptText,
        transcript_object: transcriptObject,
        candidate_id: candidate?.id,
        interview_questions: (candidate?.questions ?? interview.questions).map(
          (question) => question.question,
        ),
        // 浏览器时长只作为诊断输入，服务端完成动作会覆盖权威 duration。
        duration: clientDuration,
        client_duration: clientDuration,
        end_reason: reason,
        stats: {
          latency_samples: snapshot?.stats.latency_samples ?? [],
          latency_avg: Number((snapshot?.stats.latency_avg ?? 0).toFixed(2)),
          latency_max: Number((snapshot?.stats.latency_max ?? 0).toFixed(2)),
          interruption_count: snapshot?.stats.interruption_count ?? 0,
          audio_chunks: snapshot?.stats.audio_chunks ?? 0,
          audio_bytes: snapshot?.stats.audio_bytes ?? 0,
        },
      };

      try {
        const result = await ResponseService.finishCallSession({
          callId,
          transcript: transcriptText,
          details,
          clientDuration,
          tabSwitchCount: tabSwitchRef.current,
          endReason: reason,
        });
        savedRef.current = true;
        setFinalSession(result);
        client?.stop();

        // 评分异步触发，候选人结束页不等待模型调用；get-call 自身有服务端幂等领取。
        void axios
          .post("/api/get-call", { id: callId, token: analysisTokenRef.current })
          .catch((error) => {
            console.error("触发 AI 评分失败：", error);
          });
      } catch (error) {
        // 服务端拒绝或保存失败时保持实时连接，允许候选人校正状态后再次提交。
        endedRef.current = false;
        toast.error(error instanceof Error ? error.message : "面试结果保存失败，请重试");
        return;
      }
    } else {
      client?.stop();
    }

    // 只有拿到服务端完成结果后才切换到结束页。
    stopProctoring();
    setIsEnded(true);
  };

  startConversationRef.current = async (override) => {
    const useEmail = override?.email ?? email;
    const useName = override?.name ?? name;
    if (!mediaPermissionsReady) {
      toast.warning("请先分别完成摄像头和麦克风授权。");
      return;
    }
    if (
      (proctoringEnabled &&
        !cameraStreamRef.current?.getVideoTracks().some((track) => track.readyState === "live")) ||
      (!useTestAudioRef.current &&
        !microphoneStreamRef.current?.getAudioTracks().some((track) => track.readyState === "live"))
    ) {
      setCameraPermission((state) => (proctoringEnabled ? "failed" : state));
      setMicrophonePermission((state) => (useTestAudioRef.current ? state : "failed"));
      toast.error("摄像头或麦克风连接已中断，请重新授权后再开始。");
      return;
    }
    setLoading(true);

    try {
      const eligibility = candidate
        ? { eligible: true }
        : (
            await axios.post<{ eligible: boolean }>("/api/check-eligibility", {
              interviewId: interview.id,
              email: useEmail,
            })
          ).data;
      const isIneligible = !eligibility.eligible;

      if (isIneligible) {
        setIsOldUser(true);
        setLoading(false);

        return;
      }

      // 两项媒体权限应在开始页预先分别授权；正式开始只复用既有流。
      if (proctoringEnabled && !cameraStreamRef.current) {
        throw new Error("请先完成摄像头授权，再开始面试。");
      }
      if (!useTestAudioRef.current && !microphoneStreamRef.current) {
        throw new Error("请先完成麦克风授权，再开始面试。");
      }

      // ① 向服务端要一份会话参数（模型 / 音色 / 中文人设提示词 / 密钥）
      const data = {
        // 注册会话使用和页面倒计时相同的归一化值，避免提示词显示 20 分钟而计时器使用旧空值。
        mins: interviewTimeDuration,
        objective: interview?.objective,
        // 候选人专属邀请使用已确认的问题；旧岗位链接继续兼容岗位级历史题目。
        questions: (candidate?.questions ?? interview?.questions ?? []).map(
          (question, index) => `${index + 1}. ${question.question}`,
        ),
        name: useName || "候选人",
        email: useEmail,
      };
      const registered = await axios.post<RegisterCallResponse>("/api/register-call", {
        dynamic_data: data,
        interviewer_id: interview?.interviewer_id,
        interview_id: interview.id,
        candidate_id: candidate?.id,
        candidate_invite_token: candidate?.token,
      });
      const cfg = registered.data;

      if (!cfg?.callId || !cfg?.apiKey) {
        throw new Error(
          "服务端未返回有效的会话参数（请确认系统设置中的实时语音地址和 API 密钥已配置）",
        );
      }

      // ② 建立实时语音会话（浏览器直连平台 WebSocket）。只有 start 成功返回后，
      // 才允许向服务端写入 started_at，连接失败不会留下候选人记录。
      const client = new RealtimeVoiceClient({
        onStatus: (next, detail) => {
          setStatus(next);
          setStatusDetail(detail ?? "");

          // 连接成功后的意外断开由服务端完成动作记录，和候选人主动结束走同一条
          // 幂等路径；手动 stop 触发的 closed 会被 endedRef 拦截。
          if (
            (next === "closed" || next === "error") &&
            isStartedRef.current &&
            !endedRef.current
          ) {
            void finishCall(next === "error" ? "error" : "connection_closed");
          }
        },
        onTurns: setTurns,
        onSpeaker: setSpeaker,
        onLevel: setLevel,
        onLatency: setLatency,
        onError: (message) => toast.error(message),
      });
      clientRef.current = client;

      await withTimeout(
        client.start(
          {
            wsUrl: cfg.wsUrl,
            apiKey: cfg.apiKey,
            model: cfg.model,
            voice: cfg.voice,
            instructions: cfg.instructions,
            greeting: cfg.greeting,
            session: cfg.session,
          },
          {
            useTestAudio: useTestAudioRef.current,
            micStream: microphoneStreamRef.current ?? undefined,
          },
        ),
        15_000,
        "语音连接超时，请检查网络后重试",
      );
      // 客户端已克隆预授权麦克风流，释放预检轨道，避免同一设备重复占用。
      if (microphoneStreamRef.current) {
        const authorizedStream = microphoneStreamRef.current;
        microphoneStreamRef.current = null;
        authorizedStream.getTracks().forEach((track) => track.stop());
      }

      // ③ 语音连接成功后由服务端生成真实开始时间和到期时间。
      const session = await ResponseService.startCallSession({
        interviewId: interview.id,
        callId: cfg.callId,
        email: useEmail,
        name: useName,
        candidateId: candidate?.id,
        candidateInviteToken: candidate?.token,
      });
      if (!session.started) {
        throw new Error("该语音会话已被占用，请刷新页面后重试");
      }
      proctorSessionRef.current = session.proctoring;
      if (session.proctoring.enabled && !cameraStreamRef.current) {
        throw new Error("摄像头未就绪，无法开始受监考保护的面试。");
      }

      // 这里只用于候选人本地倒计时，服务端的 started_at / expires_at 才是最终依据。
      sessionStartPerfRef.current = performance.now();
      sessionDurationMsRef.current =
        session.startedAt && session.expiresAt
          ? Math.max(0, Date.parse(session.expiresAt) - Date.parse(session.startedAt))
          : null;
      callIdRef.current = cfg.callId;
      analysisTokenRef.current = session.analysisToken;
      sessionMetaRef.current = { model: cfg.model, voice: cfg.voice };

      isStartedRef.current = true;
      setIsStarted(true);
      setStatus("live");

      // 请求服务端开始动作期间连接也可能意外关闭；开始记录成功后马上完成，不能留下悬空会话。
      if (client.getStatus() !== "live") {
        void finishCall("connection_closed");
      }
    } catch (error) {
      console.error("startConversation failed:", error);
      toast.error(error instanceof Error ? error.message : "无法开始面试，请稍后重试");
      clientRef.current?.stop();
      stopProctoring();
    } finally {
      setLoading(false);
    }
  };

  const onEndCallClick = async () => {
    if (isStarted) {
      setLoading(true);
      await finishCall("candidate_ended");
      setLoading(false);
    } else {
      stopProctoring();
      setIsEnded(true);
    }
  };

  /* ── 派生显示值 ── */
  const lastInterviewerResponse =
    [...turns].reverse().find((t) => t.role === "agent")?.content ?? "";
  const lastUserResponse = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";
  const totalSeconds = Number(interviewTimeDuration) * 60;
  const progress = totalSeconds > 0 ? Math.min(100, (elapsed / totalSeconds) * 100) : 0;
  const remainingSeconds = Math.max(0, totalSeconds - elapsed);
  const formatDuration = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const statusLabel =
    status === "closed" || status === "error"
      ? `${STATUS_TEXT[status]}${statusDetail ? `：${statusDetail}` : ""}`
      : STATUS_TEXT[status];

  const isSetupState = !isStarted && !isEnded && !isOldUser;
  const isCompletionState = isEnded || isOldUser;

  return (
    <div className="flex min-h-[100dvh] w-full items-start justify-center overflow-x-hidden bg-gray-100 p-3 sm:p-5 md:items-center">
      {isStarted && <TabSwitchWarning />}
      <div
        className={
          cameraStream && isStarted && !isEnded
            ? "fixed bottom-4 right-4 z-30 w-36 overflow-hidden rounded-xl border-2 border-indigo-300 bg-white shadow-lg sm:w-48"
            : "hidden"
        }
      >
        <video
          ref={proctorVideoRef}
          autoPlay
          muted
          playsInline
          className="aspect-video w-full object-cover"
        />
        <p className="px-2 py-1 text-center text-xs font-medium text-slate-700">摄像头监考已开启</p>
      </div>
      {voiceDebugEnabled && (isStarted || isEnded) && (
        <div className="fixed bottom-4 left-4 z-40 max-w-[min(92vw,520px)] rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-normal text-slate-700 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-3">
            <strong className="text-amber-900">语音诊断面板</strong>
            <button
              type="button"
              className="rounded border border-amber-300 bg-white px-2 py-0.5 text-amber-900"
              onClick={() => {
                const current = readVoiceDebug();
                const payload = JSON.stringify(
                  { voice: current.voice ?? null, proctor: { ...proctorDebugRef.current } },
                  null,
                  2,
                );
                void navigator.clipboard?.writeText(payload);
                toast.success("诊断数据已复制");
              }}
            >
              复制数据
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            <DebugMetric
              label="音频分片间隔"
              value={`${voiceDebug.voice?.lastAudioDeltaGapMs ?? "-"} ms`}
            />
            <DebugMetric
              label="最大分片间隔"
              value={`${voiceDebug.voice?.audioDeltaGapMaxMs ?? "-"} ms`}
            />
            <DebugMetric
              label=">150ms 间隔"
              value={voiceDebug.voice?.audioDeltaGapOver150MsCount ?? "-"}
            />
            <DebugMetric
              label="当前播放余量"
              value={`${voiceDebug.voice?.currentQueueMs ?? "-"} ms`}
            />
            <DebugMetric label="最小播放余量" value={`${voiceDebug.voice?.minQueueMs ?? "-"} ms`} />
            <DebugMetric label="疑似断档" value={voiceDebug.voice?.queueUnderrunCount ?? "-"} />
            <DebugMetric
              label="VAD 播放中断"
              value={voiceDebug.voice?.speechStartedWhilePlayingCount ?? "-"}
            />
            <DebugMetric label="长任务次数" value={voiceDebug.proctor?.longTaskCount ?? "-"} />
            <DebugMetric label="截图编码" value={`${voiceDebug.proctor?.lastEncodeMs ?? "-"} ms`} />
            <DebugMetric label="截图绘制" value={`${voiceDebug.proctor?.lastDrawMs ?? "-"} ms`} />
            <DebugMetric
              label="最长任务"
              value={`${voiceDebug.proctor?.maxLongTaskMs ?? "-"} ms`}
            />
            <DebugMetric label="截图上传" value={`${voiceDebug.proctor?.lastUploadMs ?? "-"} ms`} />
          </div>
          <p className="mt-2 text-[11px] text-amber-800">
            重点观察：卡顿时播放余量是否接近 0、分片间隔是否超过
            150ms、是否同时出现长任务或截图编码尖峰。
          </p>
        </div>
      )}
      <div className="w-full min-w-0 max-w-5xl">
        <Card
          className={`w-full min-w-0 text-xl font-bold transition-all ${
            isCompletionState
              ? "overflow-visible border-0 bg-transparent shadow-none"
              : `overflow-y-auto rounded-lg border-2 border-b-4 border-r-4 border-black dark:border-white ${
                  isSetupState
                    ? "max-h-[calc(100dvh-1.5rem)] min-h-[calc(100dvh-1.5rem)]"
                    : "min-h-[calc(100dvh-1.5rem)]"
                }`
          }`}
        >
          <div>
            {!isCompletionState && (
              <div className="m-4 h-[15px] rounded-lg border-[1px] border-black">
                <div
                  className="h-[15px] rounded-lg bg-indigo-600"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
            {!isCompletionState && (
              <CardHeader className="items-center p-1">
                <CardTitle className="flex flex-row items-center text-lg md:text-xl font-bold mb-2">
                  {interview?.name}
                </CardTitle>
                <div className="flex mt-2 flex-row">
                  <AlarmClockIcon
                    className="text-indigo-600 h-[1rem] w-[1rem] rotate-0 scale-100  dark:-rotate-90 dark:scale-0 mr-2 font-bold"
                    style={{ color: interview.theme_color }}
                  />
                  <div className="text-sm font-normal">
                    预计时长：
                    <span className="font-bold" style={{ color: interview.theme_color }}>
                      {interviewTimeDuration} 分钟
                    </span>
                    以内
                  </div>
                </div>
              </CardHeader>
            )}

            {/* ─────────── 开始页 ─────────── */}
            {!isStarted && !isEnded && !isOldUser && (
              <div className="mx-auto mt-3 w-[calc(100%-1.5rem)] min-w-0 max-w-3xl rounded-2xl border border-indigo-200 bg-slate-50 p-3 shadow-sm sm:mt-5 sm:w-[calc(100%-2.5rem)] sm:p-5">
                {proctorNotice && (
                  <ProctorNotice
                    text={proctorNotice}
                    onDismiss={() => setProctorNotice("")}
                    className="mb-3"
                  />
                )}
                <div className="min-w-0">
                  {interview?.logo_url && (
                    <div className="p-1 flex justify-center">
                      <Image
                        src={interview?.logo_url}
                        alt="Logo"
                        className="h-10 w-auto"
                        width={100}
                        height={100}
                      />
                    </div>
                  )}
                  <div className="mb-4 min-w-0 rounded-xl border border-indigo-100 bg-white p-3 font-normal sm:p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h2 className="text-base font-semibold text-slate-900">岗位说明</h2>
                      <span className="shrink-0 text-xs font-medium text-slate-400">
                        请滚动阅读
                      </span>
                    </div>
                    <div className="max-h-[min(42vh,28rem)] overflow-y-auto overscroll-contain pr-2 text-sm leading-7 text-slate-700 [overflow-wrap:anywhere] whitespace-pre-wrap">
                      {interview?.description || "本场面试将围绕岗位要求和你的个人经历展开。"}
                    </div>
                    <div className="mt-3 border-t border-indigo-100 pt-3 text-sm font-semibold leading-6 text-slate-800">
                      请分别完成下方的摄像头和麦克风授权。建议佩戴耳机，并尽量在安静的环境下进行。
                      <br />
                      <span className="text-slate-600">注意：切换浏览器标签页会被记录。</span>
                    </div>
                  </div>
                  {candidate ? (
                    <div className="min-w-0 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-left text-sm">
                      <p className="font-medium text-slate-800">本场候选人：{candidate.name}</p>
                      <p className="mt-0.5 break-all text-slate-500">{candidate.email}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        此链接已绑定该候选人，无需再次填写个人信息。
                      </p>
                    </div>
                  ) : (
                    !interview?.is_anonymous && (
                      <div className="flex flex-col gap-2 justify-center">
                        <div className="flex justify-center">
                          <input
                            value={email}
                            className="h-fit mx-auto py-2 border-2 rounded-md w-[75%] self-center px-2 border-gray-400 text-sm font-normal"
                            placeholder="请输入邮箱"
                            onChange={(e) => setEmail(e.target.value)}
                          />
                        </div>
                        <div className="flex justify-center">
                          <input
                            value={name}
                            className="h-fit mb-4 mx-auto py-2 border-2 rounded-md w-[75%] self-center px-2 border-gray-400 text-sm font-normal"
                            placeholder="请输入姓名"
                            onChange={(e) => setName(e.target.value)}
                          />
                        </div>
                      </div>
                    )
                  )}
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <PermissionCard
                    icon={<Camera size={18} />}
                    title="摄像头权限"
                    actionLabel="授权摄像头"
                    description={
                      proctoringEnabled
                        ? "面试前必须开启摄像头。授权后会显示本地预览，面试中按设定间隔进行截图分析。"
                        : "系统当前未启用摄像头监考，不会采集摄像头画面。"
                    }
                    state={cameraPermission}
                    error={cameraPermissionError}
                    onRequest={() => void requestCameraPermission()}
                  />
                  <PermissionCard
                    icon={<Mic size={18} />}
                    title="麦克风录音权限"
                    actionLabel="授权麦克风"
                    description="用于实时语音面试和语音识别；只实时传输，不保存音频文件。授权后会复用这条麦克风流。"
                    state={useTestAudio ? "granted" : microphonePermission}
                    error={microphonePermissionError}
                    onRequest={() => void requestMicrophonePermission()}
                  />
                </div>
                {cameraStream && (
                  <div className="mt-3 overflow-hidden rounded-xl border border-indigo-100 bg-slate-900">
                    <video
                      ref={cameraPreviewRef}
                      autoPlay
                      muted
                      playsInline
                      className="aspect-video max-h-48 w-full object-cover"
                    />
                    <p className="px-3 py-2 text-center text-xs font-normal text-white">
                      摄像头预览正常，面试时会继续保持开启
                    </p>
                  </div>
                )}
                <div className="mx-auto flex w-full flex-wrap items-center justify-center gap-2 pt-2">
                  <Button
                    className="h-10 min-w-28 rounded-lg"
                    style={{
                      backgroundColor: interview.theme_color ?? "#4F46E5",
                      color: isLightColor(interview.theme_color ?? "#4F46E5") ? "black" : "white",
                    }}
                    disabled={
                      Loading ||
                      !permissionConfigLoaded ||
                      !mediaPermissionsReady ||
                      (!candidate && !interview?.is_anonymous && (!isValidEmail || !name))
                    }
                    onClick={() => startConversationRef.current?.()}
                  >
                    {!Loading ? (
                      mediaPermissionsReady ? (
                        "开始面试"
                      ) : (
                        "请先完成设备授权"
                      )
                    ) : (
                      <MiniLoader />
                    )}
                  </Button>
                  <AlertDialog>
                    {/* asChild：避免 AlertDialogTrigger 再套一层 button（原版会产生 button 嵌套 button 的水合警告） */}
                    <AlertDialogTrigger asChild>
                      <Button
                        className="h-10 min-w-20 border bg-white text-black"
                        style={{ borderColor: interview.theme_color }}
                        disabled={Loading}
                      >
                        退出
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="max-h-[min(90dvh,42rem)] max-w-lg overflow-y-auto p-0">
                      <AlertDialogHeader>
                        <AlertDialogTitle>确定要退出吗？</AlertDialogTitle>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-indigo-600 hover:bg-indigo-800"
                          onClick={async () => {
                            await onEndCallClick();
                          }}
                        >
                          确认
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            )}

            {/* ─────────── 通话中 ─────────── */}
            {isStarted && !isEnded && !isOldUser && (
              <>
                {proctorNotice && (
                  <ProctorNotice
                    text={proctorNotice}
                    onDismiss={() => setProctorNotice("")}
                    className="mx-auto my-2 max-w-xl"
                  />
                )}
                <div className="flex flex-row items-center justify-center gap-3 text-xs font-normal text-gray-500">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      status === "live"
                        ? "bg-green-500"
                        : status === "connecting"
                          ? "bg-yellow-500"
                          : "bg-red-500"
                    }`}
                  />
                  <span>{statusLabel}</span>
                  {latency !== null && <span>· 响应延迟 {latency.toFixed(2)} 秒</span>}
                  <span>· 已用时 {formatDuration(elapsed)}</span>
                  <span>· 剩余 {formatDuration(remainingSeconds)}</span>
                </div>
                <div className="mx-auto w-[70%] h-[6px] my-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-[width] duration-75"
                    style={{ width: `${Math.min(100, level * 420)}%` }}
                  />
                </div>
                <div className="flex flex-col md:flex-row p-2 grow">
                  <div className="border-x-2 border-grey w-full md:w-[50%] my-auto min-h-[35%] md:min-h-[70%]">
                    <div className="flex flex-col justify-evenly">
                      <div className="text-base w-[90%] md:w-[80%] md:text-[26px] mt-4 min-h-[140px] md:min-h-[250px] mx-auto px-3 md:px-6">
                        {lastInterviewerResponse}
                      </div>
                      <div className="flex flex-col mx-auto justify-center items-center align-middle">
                        <Image
                          src={interviewerImg || "/user-icon.png"}
                          alt="面试官头像"
                          width={120}
                          height={120}
                          className={`object-cover object-center mx-auto my-auto ${
                            speaker === "agent"
                              ? `border-4 border-[${interview.theme_color}] rounded-full`
                              : ""
                          }`}
                          onError={(event) => {
                            // 候选人面试中始终保留头像占位，避免面试官查询失败导致布局跳动。
                            event.currentTarget.src = "/user-icon.png";
                          }}
                        />
                        <div className="font-semibold">AI 面试官</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col justify-evenly w-full md:w-[50%]">
                    <div
                      ref={lastUserResponseRef}
                      className="text-base w-[90%] md:w-[80%] md:text-[26px] mt-4 mx-auto h-[140px] md:h-[250px] px-3 md:px-6 overflow-y-auto"
                    >
                      {lastUserResponse}
                    </div>
                    <div className="flex flex-col mx-auto justify-center items-center align-middle">
                      <Image
                        src={"/user-icon.png"}
                        alt="候选人头像"
                        width={120}
                        height={120}
                        className={`object-cover object-center mx-auto my-auto ${
                          speaker === "user"
                            ? `border-4 border-[${interview.theme_color}] rounded-full`
                            : ""
                        }`}
                      />
                      <div className="font-semibold">你</div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {isStarted && !isEnded && !isOldUser && (
              <div className="items-center p-2">
                <AlertDialog>
                  <AlertDialogTrigger asChild className="w-full">
                    <Button
                      className=" bg-white text-black border  border-indigo-600 h-10 mx-auto flex flex-row justify-center mb-8"
                      disabled={Loading}
                    >
                      结束面试{" "}
                      <XCircleIcon className="h-[1.5rem] ml-2 w-[1.5rem] rotate-0 scale-100  dark:-rotate-90 dark:scale-0 text-red" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>确定要结束吗？</AlertDialogTitle>
                      <AlertDialogDescription>
                        此操作无法撤销，将立即结束本次面试并提交你的回答。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-indigo-600 hover:bg-indigo-800"
                        onClick={async () => {
                          await onEndCallClick();
                        }}
                      >
                        确认
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}

            {/* ─────────── 结束页 ─────────── */}
            {isEnded && !isOldUser && (
              <div className="mx-auto w-full max-w-xl px-1 py-3 sm:px-4 sm:py-5">
                <div className="w-full min-w-0 rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm sm:p-6">
                  <div className="font-normal text-base">
                    <CheckCircleIcon className="mx-auto my-4 h-8 w-8 text-indigo-500" />
                    <p className="text-center text-lg font-semibold text-slate-900">
                      {isStarted ? "感谢你参加本次面试" : "感谢你的关注。"}
                    </p>
                    <p className="mt-2 text-center text-sm leading-6 text-slate-600">
                      现在可以关闭这个页面了。
                    </p>
                    {finalSession && (
                      <div className="mt-5 grid gap-3 border-t border-indigo-100 pt-4 text-sm font-normal sm:grid-cols-2">
                        <p className="rounded-lg bg-slate-50 p-3 text-center text-slate-600">
                          服务端记录时长：
                          <span className="font-semibold text-slate-900">
                            {formatDuration(finalSession.serverDuration ?? 0)}
                          </span>
                        </p>
                        <p className="rounded-lg bg-slate-50 p-3 text-center text-slate-600">
                          结束原因：
                          <span className="font-semibold text-slate-900">
                            {END_REASON_TEXT[finalSession.endReason]}
                          </span>
                        </p>
                      </div>
                    )}
                  </div>

                  {!isFeedbackSubmitted && (
                    <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                      <AlertDialogTrigger asChild className="w-full flex justify-center">
                        <Button
                          className="bg-indigo-600 text-white h-10 mt-4 mb-4"
                          onClick={() => setIsDialogOpen(true)}
                        >
                          填写反馈
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="max-h-[min(90dvh,42rem)] max-w-lg overflow-y-auto p-0">
                        <AlertDialogHeader className="border-b border-indigo-100 px-5 py-4 text-left">
                          <AlertDialogTitle>填写面试反馈</AlertDialogTitle>
                          <AlertDialogDescription>
                            你的反馈只用于改进面试体验，不会影响本次面试结果。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <FeedbackForm email={email} onSubmit={handleFeedbackSubmit} />
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
            )}

            {/* ─────────── 不可参加 ─────────── */}
            {isOldUser && (
              <div className="mx-auto w-full max-w-xl px-1 py-3 sm:px-4 sm:py-5">
                <div className="w-full min-w-0 rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm sm:p-6">
                  <div className="text-base font-normal leading-7">
                    <CheckCircleIcon className="mx-auto my-4 h-8 w-8 text-indigo-500" />
                    <p className="text-center text-lg font-semibold text-slate-900">
                      你已完成本次面试，或不在本次面试的邀请名单内。感谢你的关注！
                    </p>
                    <p className="mt-2 text-center text-sm text-slate-600">
                      现在可以关闭这个页面了。
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>
        <a
          className="flex flex-row justify-center align-middle mt-3"
          href="https://folo-up.co/"
          target="_blank"
          rel="noreferrer"
        >
          <div className="text-center text-md font-semibold mr-2  ">
            Powered by{" "}
            <span className="font-bold">
              Folo<span className="text-indigo-600">Up</span>
            </span>
          </div>
          <ArrowUpRightSquareIcon className="h-[1.5rem] w-[1.5rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-indigo-500 " />
        </a>
      </div>
    </div>
  );
}

export default Call;
