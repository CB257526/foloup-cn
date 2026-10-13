"use client";

import { FeedbackForm } from "@/components/call/feedbackForm";
import {
  type RealtimeStatus,
  RealtimeVoiceClient,
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
import { AlarmClockIcon, ArrowUpRightSquareIcon, CheckCircleIcon, XCircleIcon } from "lucide-react";
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
  const proctorVideoRef = useRef<HTMLVideoElement | null>(null);
  const proctorSessionRef = useRef<ProctorSessionConfig | null>(null);
  const proctorInFlightRef = useRef(false);
  const proctorTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const { tabSwitchCount } = useTabSwitchPrevention();
  const tabSwitchRef = useRef(0);
  tabSwitchRef.current = tabSwitchCount;

  useEffect(() => {
    isStartedRef.current = isStarted;
  }, [isStarted]);

  /* ── 音频来源：默认麦克风；?voiceInput=file 时用测试音频（自动化验证用） ── */
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    useTestAudioRef.current = qs.get("voiceInput") === "file";
    autoStartRef.current = qs.get("autostart") === "1";
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
    cameraStreamRef.current = null;
    proctorSessionRef.current = null;
    setCameraStream(null);
    if (proctorVideoRef.current) proctorVideoRef.current.srcObject = null;
  };

  const captureProctorFrame = async () => {
    const session = proctorSessionRef.current;
    const video = proctorVideoRef.current;
    if (!session?.enabled || !session.token || !video || proctorInFlightRef.current) return;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth < 1) return;

    proctorInFlightRef.current = true;
    try {
      const canvas = captureCanvasRef.current || document.createElement("canvas");
      captureCanvasRef.current = canvas;
      const targetWidth = Math.min(640, video.videoWidth);
      const targetHeight = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * targetWidth));
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("无法读取摄像头画面。");
      context.drawImage(video, 0, 0, targetWidth, targetHeight);
      const imageDataUrl = canvas.toDataURL("image/jpeg", 0.62);
      const snapshot = clientRef.current?.snapshot();
      const transcript = (snapshot?.turns ?? []).map((turn) => ({
        role: turn.role,
        content: turn.content,
        offset_ms: turn.offset_ms,
      }));
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
        setProctorNotice(`监考提醒 ${result.strikeCount}/${result.maxStrikes ?? 3}：${label}。${result.event.summary}`);
        toast.warning(`监考提醒 ${result.strikeCount}/${result.maxStrikes ?? 3}`, {
          description: `${label}：${result.event.summary}`,
          duration: 8000,
        });
      } else if (result.status === "clear") {
        setProctorNotice("");
      }
      if ((result.consecutiveFailures ?? 0) === 3) {
        setProctorNotice("视觉分析暂不可用，截图已保存，面试会继续进行，相关记录将由招聘人员人工复核。");
      }
      if (result.terminated) {
        setProctorNotice("累计监考风险事件已达到上限，本场面试已结束。");
        await finishCall("proctoring_terminated");
      }
    } catch (error) {
      const statusCode = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (statusCode !== 429) {
        console.error("摄像头截图分析失败：", error instanceof Error ? error.message : String(error));
        setProctorNotice("摄像头截图暂时无法分析，面试会继续进行；请保持摄像头开启。");
      }
    } finally {
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
    if (!cameraStream || !proctorVideoRef.current) return;
    proctorVideoRef.current.srcObject = cameraStream;
    void proctorVideoRef.current.play().catch(() => {
      setProctorNotice("摄像头预览未能自动播放，但截图监考仍会尝试继续。");
    });
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
    stopProctoring();

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
        void axios.post("/api/get-call", { id: callId, token: analysisTokenRef.current }).catch((error) => {
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
    setIsEnded(true);
  };

  startConversationRef.current = async (override) => {
    const useEmail = override?.email ?? email;
    const useName = override?.name ?? name;
    setLoading(true);

    try {
      const eligibility = candidate
        ? { eligible: true }
        : (await axios.post<{ eligible: boolean }>("/api/check-eligibility", {
            interviewId: interview.id,
            email: useEmail,
          })).data;
      const isIneligible = !eligibility.eligible;

      if (isIneligible) {
        setIsOldUser(true);
        setLoading(false);

        return;
      }

      // 摄像头权限在确定候选人可参加后、建立语音连接前请求，拒绝时不创建面试会话。
      const proctorConfig = (await axios.get<{ enabled: boolean }>("/api/proctor/config")).data;
      if (proctorConfig.enabled) {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("当前浏览器无法访问摄像头，请改用支持摄像头的安全浏览器。");
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 5, max: 10 } },
          });
          cameraStreamRef.current = stream;
          setCameraStream(stream);
          if (proctorVideoRef.current) {
            proctorVideoRef.current.srcObject = stream;
            await proctorVideoRef.current.play();
          }
          stream.getVideoTracks().forEach((track) => {
            track.addEventListener("ended", () => {
              setProctorNotice("摄像头已关闭或连接中断，请重新开启摄像头并联系招聘人员。");
              if (isStartedRef.current && !endedRef.current) {
                toast.error("摄像头连接中断，请联系招聘人员；本次面试仍可继续。");
              }
            });
          });
        } catch {
          throw new Error("需要允许使用摄像头才能开始本次面试，请检查浏览器权限和摄像头设备。");
        }
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
        throw new Error("服务端未返回有效的会话参数（请确认服务端已配置 QWEN_API_KEY）");
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
          { useTestAudio: useTestAudioRef.current },
        ),
        15_000,
        "语音连接超时，请检查网络后重试",
      );

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

  return (
    <div className="flex justify-center items-center min-h-screen bg-gray-100">
      {isStarted && <TabSwitchWarning />}
      <div className={cameraStream ? "fixed bottom-4 right-4 z-30 w-36 overflow-hidden rounded-xl border-2 border-indigo-300 bg-white shadow-lg sm:w-48" : "hidden"}>
        <video ref={proctorVideoRef} autoPlay muted playsInline className="aspect-video w-full object-cover" />
        <p className="px-2 py-1 text-center text-xs font-medium text-slate-700">摄像头监考已开启</p>
      </div>
      <div className="bg-white rounded-md md:w-[80%] w-[90%]">
        <Card className="h-[88vh] rounded-lg border-2 border-b-4 border-r-4 border-black text-xl font-bold transition-all  md:block dark:border-white ">
          <div>
            <div className="m-4 h-[15px] rounded-lg border-[1px]  border-black">
              <div
                className=" bg-indigo-600 h-[15px] rounded-lg"
                style={{ width: isEnded ? "100%" : `${progress}%` }}
              />
            </div>
            <CardHeader className="items-center p-1">
              {!isEnded && (
                <CardTitle className="flex flex-row items-center text-lg md:text-xl font-bold mb-2">
                  {interview?.name}
                </CardTitle>
              )}
              {!isEnded && (
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
              )}
            </CardHeader>

            {/* ─────────── 开始页 ─────────── */}
            {!isStarted && !isEnded && !isOldUser && (
              <div className="w-[calc(100%-1rem)] max-w-[400px] min-w-0 mx-auto mt-2 border border-indigo-200 rounded-md p-2 m-2 bg-slate-50">
                {proctorNotice && <p role="status" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm font-normal text-amber-900">{proctorNotice}</p>}
                <div>
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
                  <div className="p-2 font-normal text-sm mb-4 whitespace-pre-line">
                    {interview?.description}
                    <p className="font-bold text-sm">
                      {"\n"}请调高音量，并在浏览器提示时允许使用麦克风。建议佩戴耳机，并尽量在安静的
                      环境下进行。
                      {"\n\n"}注意：切换浏览器标签页会被记录。
                    </p>
                  </div>
                  {candidate ? (
                    <div className="rounded-lg border border-indigo-100 bg-white px-3 py-2 text-left text-sm">
                      <p className="font-medium text-slate-800">本场候选人：{candidate.name}</p>
                      <p className="mt-0.5 text-slate-500">{candidate.email}</p>
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
                <div className="w-[80%] flex flex-row mx-auto justify-center items-center align-middle">
                  <Button
                    className="min-w-20 h-10 rounded-lg flex flex-row justify-center mb-8"
                    style={{
                      backgroundColor: interview.theme_color ?? "#4F46E5",
                      color: isLightColor(interview.theme_color ?? "#4F46E5") ? "black" : "white",
                    }}
                    disabled={
                      Loading ||
                      (!candidate && !interview?.is_anonymous && (!isValidEmail || !name))
                    }
                    onClick={() => startConversationRef.current?.()}
                  >
                    {!Loading ? "开始面试" : <MiniLoader />}
                  </Button>
                  <AlertDialog>
                    {/* asChild：避免 AlertDialogTrigger 再套一层 button（原版会产生 button 嵌套 button 的水合警告） */}
                    <AlertDialogTrigger asChild>
                      <Button
                        className="bg-white border ml-2 text-black min-w-15 h-10 rounded-lg flex flex-row justify-center mb-8"
                        style={{ borderColor: interview.theme_color }}
                        disabled={Loading}
                      >
                        退出
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
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
                {proctorNotice && <div role="status" className="mx-auto my-2 max-w-xl rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-normal text-amber-900">{proctorNotice}</div>}
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
              <div className="w-[calc(100%-2rem)] max-w-[400px] min-w-0 mx-auto mt-2 border border-indigo-200 rounded-md p-2 m-2 bg-slate-50 absolute -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2">
                <div>
                  <div className="p-2 font-normal text-base mb-4 whitespace-pre-line">
                    <CheckCircleIcon className="h-[2rem] w-[2rem] mx-auto my-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-indigo-500 " />
                    <p className="text-lg font-semibold text-center">
                      {isStarted ? "感谢你参加本次面试" : "感谢你的关注。"}
                    </p>
                    <p className="text-center">
                      {"\n"}
                      现在可以关闭这个页面了。
                    </p>
                    {finalSession && (
                      <div className="mt-4 border-t border-indigo-100 pt-3 text-center text-sm font-normal">
                        <p>
                          服务端记录时长：
                          <span className="font-semibold">
                            {formatDuration(finalSession.serverDuration ?? 0)}
                          </span>
                        </p>
                        <p className="mt-1">
                          结束原因：
                          <span className="font-semibold">
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
                      <AlertDialogContent>
                        <FeedbackForm email={email} onSubmit={handleFeedbackSubmit} />
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
            )}

            {/* ─────────── 不可参加 ─────────── */}
            {isOldUser && (
              <div className="w-[calc(100%-2rem)] max-w-[400px] min-w-0 mx-auto mt-2 border border-indigo-200 rounded-md p-2 m-2 bg-slate-50 absolute -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2">
                <div>
                  <div className="p-2 font-normal text-base mb-4 whitespace-pre-line">
                    <CheckCircleIcon className="h-[2rem] w-[2rem] mx-auto my-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-indigo-500 " />
                    <p className="text-lg font-semibold text-center">
                      你已完成本次面试，或不在本次面试的邀请名单内。感谢你的关注！
                    </p>
                    <p className="text-center">
                      {"\n"}
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
