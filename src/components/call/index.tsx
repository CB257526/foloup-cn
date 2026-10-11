"use client";

import { FeedbackForm } from "@/components/call/feedbackForm";
import {
  RealtimeVoiceClient,
  type RealtimeStatus,
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
import { isLightColor, testEmail } from "@/lib/utils";
import { FeedbackService } from "@/services/feedback.service";
import { InterviewerService } from "@/services/interviewers.service";
import { ResponseService } from "@/services/responses.service";
import { DEFAULT_INTERVIEW_DURATION_MINUTES, normalizeInterviewDuration } from "@/lib/constants";
import type { Interview } from "@/types/interview";
import type { CallData, FeedbackData, TranscriptTurn } from "@/types/response";
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

const STATUS_TEXT: Record<RealtimeStatus, string> = {
  idle: "未连接",
  connecting: "正在连接语音服务…",
  live: "对话进行中",
  closed: "连接已断开",
  error: "连接异常",
};

function Call({ interview }: CallProps) {
  /* ── 表单与流程状态 ── */
  const [Loading, setLoading] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [isEnded, setIsEnded] = useState(false);
  const [email, setEmail] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [isValidEmail, setIsValidEmail] = useState<boolean>(false);
  const [isOldUser, setIsOldUser] = useState<boolean>(false);
  const [isFeedbackSubmitted, setIsFeedbackSubmitted] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [interviewerImg, setInterviewerImg] = useState("");
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

  const clientRef = useRef<RealtimeVoiceClient | null>(null);
  const callIdRef = useRef<string>("");
  const sessionMetaRef = useRef<{ model: string; voice: string }>({ model: "", voice: "" });
  const savedRef = useRef(false);
  const endedRef = useRef(false);
  const useTestAudioRef = useRef(false);
  const autoStartRef = useRef(false);
  const startConversationRef =
    useRef<(override?: { email?: string; name?: string }) => Promise<void>>();
  const lastUserResponseRef = useRef<HTMLDivElement | null>(null);

  const { tabSwitchCount } = useTabSwitchPrevention();
  const tabSwitchRef = useRef(0);
  tabSwitchRef.current = tabSwitchCount;

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
      const interviewer = await InterviewerService.getInterviewer(interview.interviewer_id);
      setInterviewerImg(interviewer?.image ?? "");
    };
    fetchInterviewer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interview.interviewer_id]);

  // 候选人侧文本变化 → 自动滚到底
  useEffect(() => {
    if (lastUserResponseRef.current) {
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
    if (isStarted && !isEnded && limit > 0 && elapsed >= limit) {
      void finishCall("time_up");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, isStarted, isEnded, interviewTimeDuration]);

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

  /** 结束通话 → 停音频 → 把转录与指标落库（走 Server Action，不直连数据库） */
  const finishCall = async (reason: "candidate_ended" | "time_up" | "error") => {
    if (endedRef.current) {
      return;
    }
    endedRef.current = true;

    const client = clientRef.current;
    const snapshot = client?.snapshot();
    client?.stop();

    const callId = callIdRef.current;
    if (callId && !savedRef.current) {
      savedRef.current = true;

      const transcriptObject: TranscriptTurn[] = (snapshot?.turns ?? []).map((t) => ({
        role: t.role,
        content: t.content,
        offset_ms: t.offset_ms,
      }));
      const speakerName = name || "候选人";
      const transcriptText = transcriptObject
        .map((t) => `${t.role === "agent" ? "AI 面试官" : speakerName}：${t.content}`)
        .join("\n\n");
      const duration = Math.round(snapshot?.duration ?? elapsed);

      const details: CallData = {
        call_id: callId,
        interview_id: interview.id,
        model: sessionMetaRef.current.model,
        voice: sessionMetaRef.current.voice,
        transcript: transcriptText,
        transcript_object: transcriptObject,
        duration,
        started_at: new Date(Date.now() - duration * 1000).toISOString(),
        ended_at: new Date().toISOString(),
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

      await ResponseService.saveResponse(
        {
          transcript: transcriptText,
          details,
          duration,
          is_ended: true,
          tab_switch_count: tabSwitchRef.current,
        },
        callId,
      );

      // 🔗 触发一次 AI 评分（原 Retell webhook → /api/get-call 的链路在删掉 webhook 后消失，
      //    这里补上触发点；get-call 内部有 is_analysed 幂等判断，重复调用不会重复评分）。
      //    不 await：评分要几十秒，不能让候选人卡在结束页之前。失败也不影响候选人页面
      //    （HR 打开应答详情时 callInfo 会再触发一次）。
      void axios.post("/api/get-call", { id: callId }).catch((error) => {
        console.error("触发 AI 评分失败：", error);
      });
    }

    setIsEnded(true);
  };

  startConversationRef.current = async (override) => {
    const useEmail = override?.email ?? email;
    const useName = override?.name ?? name;
    setLoading(true);

    try {
      const oldUserEmails: string[] = (await ResponseService.getAllEmails(interview.id)).map(
        (item) => item.email,
      );
      const isIneligible =
        oldUserEmails.includes(useEmail) ||
        Boolean(interview?.respondents?.length && !interview.respondents.includes(useEmail));

      if (isIneligible) {
        setIsOldUser(true);
        setLoading(false);

        return;
      }

      // ① 向服务端要一份会话参数（模型 / 音色 / 中文人设提示词 / 密钥）
      const data = {
        // 注册会话使用和页面倒计时相同的归一化值，避免提示词显示 20 分钟而计时器使用旧空值。
        mins: interviewTimeDuration,
        objective: interview?.objective,
        questions: interview?.questions.map((q) => q.question).join(", "),
        name: useName || "候选人",
      };
      const registered = await axios.post<RegisterCallResponse>("/api/register-call", {
        dynamic_data: data,
        interviewer_id: interview?.interviewer_id,
      });
      const cfg = registered.data;

      if (!cfg?.callId || !cfg?.apiKey) {
        throw new Error("服务端未返回有效的会话参数（请确认服务端已配置 QWEN_API_KEY）");
      }

      // ② 建一条应答记录（Server Action）
      await ResponseService.createResponse({
        interview_id: interview.id,
        call_id: cfg.callId,
        email: useEmail,
        name: useName,
      });
      callIdRef.current = cfg.callId;
      sessionMetaRef.current = { model: cfg.model, voice: cfg.voice };

      // ③ 建立实时语音会话（浏览器直连平台 WebSocket）
      const client = new RealtimeVoiceClient({
        onStatus: (next, detail) => {
          setStatus(next);
          setStatusDetail(detail ?? "");
        },
        onTurns: setTurns,
        onSpeaker: setSpeaker,
        onLevel: setLevel,
        onLatency: setLatency,
        onError: (message) => toast.error(message),
      });
      clientRef.current = client;

      await client.start(
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
      );

      setIsStarted(true);
      setStatus("live");
    } catch (error) {
      console.error("startConversation failed:", error);
      toast.error(error instanceof Error ? error.message : "无法开始面试，请稍后重试");
      clientRef.current?.stop();
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
                  {!interview?.is_anonymous && (
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
                  )}
                </div>
                <div className="w-[80%] flex flex-row mx-auto justify-center items-center align-middle">
                  <Button
                    className="min-w-20 h-10 rounded-lg flex flex-row justify-center mb-8"
                    style={{
                      backgroundColor: interview.theme_color ?? "#4F46E5",
                      color: isLightColor(interview.theme_color ?? "#4F46E5") ? "black" : "white",
                    }}
                    disabled={Loading || (!interview?.is_anonymous && (!isValidEmail || !name))}
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
