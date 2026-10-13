"use client";

import {
  saveAppSettingsAction,
  testLlmConnectionAction,
  testLlmVisionAction,
  testRealtimeConnectionAction,
} from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Eye, EyeOff, Loader2, Save, ServerCog, Wifi } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type SettingsSnapshot = {
  llmBaseUrl: string;
  llmModel: string;
  llmMaxTokens: number;
  llmTimeoutMs: number;
  llmJsonMode: boolean;
  realtimeWsUrl: string;
  realtimeModel: string;
  asrModel: string;
  defaultInterviewDuration: number;
  proctoringEnabled: boolean;
  proctoringIntervalSeconds: number;
  proctoringConfidenceThreshold: number;
  apiKeyConfigured: boolean;
  realtimeApiKeyConfigured: boolean;
};

type FormState = Omit<SettingsSnapshot, "apiKeyConfigured" | "realtimeApiKeyConfigured"> & {
  llmApiKey: string;
  realtimeApiKey: string;
};

interface Props {
  initialSettings: SettingsSnapshot;
}

function SecretField({
  label,
  value,
  configured,
  visible,
  placeholder,
  onChange,
  onToggleVisibility,
}: {
  label: string;
  value: string;
  configured: boolean;
  visible: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onToggleVisibility: () => void;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      <div className="relative">
        <input
          className="w-full rounded-md border px-3 py-2 pr-10"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="new-password"
        />
        <button
          type="button"
          aria-label={visible ? `隐藏${label}` : `显示${label}`}
          className="absolute right-2 top-2 text-slate-500"
          onClick={onToggleVisibility}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      <span
        className={`inline-flex items-center gap-1 text-xs ${configured ? "text-emerald-600" : "text-amber-600"}`}
      >
        {configured && <CheckCircle2 size={14} />}
        {configured ? "服务端已配置，不会在页面回显" : "尚未配置"}
      </span>
    </label>
  );
}

function SettingsForm({ initialSettings }: Props) {
  const [settings, setSettings] = useState<FormState>({
    ...initialSettings,
    llmApiKey: "",
    realtimeApiKey: "",
  });
  const [llmApiKeyConfigured, setLlmApiKeyConfigured] = useState(initialSettings.apiKeyConfigured);
  const [realtimeApiKeyConfigured, setRealtimeApiKeyConfigured] = useState(
    initialSettings.realtimeApiKeyConfigured,
  );
  const [showLlmApiKey, setShowLlmApiKey] = useState(false);
  const [showRealtimeApiKey, setShowRealtimeApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingRealtime, setTestingRealtime] = useState(false);
  const [testingVision, setTestingVision] = useState(false);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const busy = saving || testing || testingRealtime || testingVision;

  const save = async () => {
    setSaving(true);
    try {
      const next = await saveAppSettingsAction({ ...settings });
      setSettings((current) => ({ ...current, ...next, llmApiKey: "", realtimeApiKey: "" }));
      setLlmApiKeyConfigured(next.apiKeyConfigured);
      setRealtimeApiKeyConfigured(next.realtimeApiKeyConfigured);
      toast.success("系统设置已保存，新面试会使用最新配置");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败，请检查设置内容");
    } finally {
      setSaving(false);
    }
  };

  const testTextConnection = async () => {
    setTesting(true);
    try {
      const result = await testLlmConnectionAction({
        llmBaseUrl: settings.llmBaseUrl,
        llmModel: settings.llmModel,
        llmMaxTokens: settings.llmMaxTokens,
        llmTimeoutMs: settings.llmTimeoutMs,
        llmJsonMode: settings.llmJsonMode,
        llmApiKey: settings.llmApiKey,
      });
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "文本模型连接测试失败");
    } finally {
      setTesting(false);
    }
  };

  const testRealtimeConnection = async () => {
    setTestingRealtime(true);
    try {
      const result = await testRealtimeConnectionAction({
        realtimeWsUrl: settings.realtimeWsUrl,
        realtimeModel: settings.realtimeModel,
        asrModel: settings.asrModel,
        realtimeApiKey: settings.realtimeApiKey,
      });
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "实时语音连接测试失败");
    } finally {
      setTestingRealtime(false);
    }
  };

  const testVisionConnection = async () => {
    setTestingVision(true);
    try {
      const result = await testLlmVisionAction();
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "视觉输入测试失败");
    } finally {
      setTestingVision(false);
    }
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">系统设置</h2>
          <p className="mt-1 text-sm text-slate-500">
            文本模型和实时语音是两条独立链路。保存后，新面试会读取最新配置；测试按钮会实际请求对应服务。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={testTextConnection} disabled={busy}>
            {testing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ServerCog className="mr-2 h-4 w-4" />
            )}
            测试文本模型
          </Button>
          <Button type="button" variant="outline" onClick={testRealtimeConnection} disabled={busy}>
            {testingRealtime ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Wifi className="mr-2 h-4 w-4" />
            )}
            测试实时语音
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={busy}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            保存设置
          </Button>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <div className="mb-5 flex items-start gap-3">
          <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
            <ServerCog size={20} />
          </div>
          <div>
            <h3 className="font-semibold">文本模型</h3>
            <p className="mt-1 text-sm text-slate-500">
              用于自动出题、候选人评分、岗位洞察和摄像头截图分析，使用 OpenAI 兼容的 Chat
              Completions 协议。
            </p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium">接口基址</span>
            <input
              className="w-full rounded-md border px-3 py-2"
              value={settings.llmBaseUrl}
              onChange={(event) => update("llmBaseUrl", event.target.value)}
              placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
            />
            <span className="block text-xs leading-5 text-slate-500">
              这里只填接口基址，系统会自动请求其下的 <code>/chat/completions</code>
              ，不要把完整路径重复填进去。
            </span>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">模型名称</span>
            <input
              className="w-full rounded-md border px-3 py-2"
              value={settings.llmModel}
              onChange={(event) => update("llmModel", event.target.value)}
              placeholder="例如 qwen-plus 或 deepseek-v4.1-flash"
            />
          </label>
          <SecretField
            label="文本模型 API 密钥"
            value={settings.llmApiKey}
            configured={llmApiKeyConfigured}
            visible={showLlmApiKey}
            placeholder={
              llmApiKeyConfigured ? "已配置，留空表示保持不变" : "请输入文本模型平台 API 密钥"
            }
            onChange={(value) => update("llmApiKey", value)}
            onToggleVisibility={() => setShowLlmApiKey((visible) => !visible)}
          />
          <label className="space-y-1 text-sm">
            <span className="font-medium">最大输出 Token</span>
            <input
              className="w-full rounded-md border px-3 py-2"
              type="number"
              min={2000}
              max={32000}
              step={500}
              value={settings.llmMaxTokens}
              onChange={(event) => update("llmMaxTokens", Number(event.target.value))}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">请求超时（毫秒）</span>
            <input
              className="w-full rounded-md border px-3 py-2"
              type="number"
              min={5000}
              max={120000}
              step={1000}
              value={settings.llmTimeoutMs}
              onChange={(event) => update("llmTimeoutMs", Number(event.target.value))}
            />
          </label>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.llmJsonMode}
            onChange={(event) => update("llmJsonMode", event.target.checked)}
          />
          要求模型优先返回结构化 JSON
        </label>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <div className="mb-5 flex items-start gap-3">
          <div className="rounded-lg bg-sky-50 p-2 text-sky-600">
            <Wifi size={20} />
          </div>
          <div>
            <h3 className="font-semibold">实时语音模型</h3>
            <p className="mt-1 text-sm text-slate-500">
              候选人开始面试时，浏览器通过 WebSocket
              连接这里配置的实时语音服务。它和文本模型可以使用不同平台、地址和 API 密钥。
            </p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium">WebSocket 请求地址</span>
            <input
              className="w-full rounded-md border px-3 py-2"
              value={settings.realtimeWsUrl}
              onChange={(event) => update("realtimeWsUrl", event.target.value)}
              placeholder="wss://<workspace>.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime"
            />
            <span className="block text-xs leading-5 text-slate-500">
              必须是 <code>ws://</code> 或 <code>wss://</code>
              。不同地域或工作空间可能使用不同地址，请以服务商控制台和接口文档为准。
            </span>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">实时语音模型</span>
            <input
              className="w-full rounded-md border px-3 py-2"
              value={settings.realtimeModel}
              onChange={(event) => update("realtimeModel", event.target.value)}
              placeholder="例如 qwen3.8-omni-flash-realtime"
            />
          </label>
          <SecretField
            label="实时语音 API 密钥"
            value={settings.realtimeApiKey}
            configured={realtimeApiKeyConfigured}
            visible={showRealtimeApiKey}
            placeholder={
              realtimeApiKeyConfigured ? "已配置，留空表示保持不变" : "请输入实时语音平台 API 密钥"
            }
            onChange={(value) => update("realtimeApiKey", value)}
            onToggleVisibility={() => setShowRealtimeApiKey((visible) => !visible)}
          />
        </div>

        <div className="mt-6 rounded-lg border border-violet-200 bg-violet-50 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-white p-2 text-violet-600">
              <ServerCog size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="font-semibold text-violet-950">输入语音识别（ASR）</h4>
              <p className="mt-1 text-sm leading-6 text-violet-900">
                ASR 不是另一条 HTTP 请求：当前实时语音协议会在同一条 WebSocket
                会话里完成语音识别。这里的模型名会被写入
                <code className="mx-1">session.update</code>
                并由“测试实时语音”实际验证。
              </p>
              <label className="mt-3 block max-w-xl space-y-1 text-sm text-violet-950">
                <span className="font-medium">ASR 模型名称</span>
                <input
                  className="w-full rounded-md border border-violet-300 bg-white px-3 py-2"
                  value={settings.asrModel}
                  onChange={(event) => update("asrModel", event.target.value)}
                  placeholder="例如 qwen3-asr-flash-realtime"
                />
              </label>
              <p className="mt-2 text-xs leading-5 text-violet-800">
                通义实时语音通常要求使用 <code>qwen3-asr-flash-realtime</code>
                ；如果服务商固定该模型，请保持默认值。ASR 不会额外重复配置 API 密钥。
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <div className="mb-5 flex items-start gap-3">
          <div className="rounded-lg bg-amber-50 p-2 text-amber-600">
            <ServerCog size={20} />
          </div>
          <div>
            <h3 className="font-semibold">摄像头监考</h3>
            <p className="mt-1 text-sm text-slate-600">
              候选人摄像头截图会发送给当前文本模型分析。请使用支持图像输入的多模态模型。
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
          截图会保存在本地服务器 7
          天，并发送至当前文本模型服务商进行分析。视觉输入测试失败只显示警告，不阻止保存或启用。
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.proctoringEnabled}
              onChange={(event) => update("proctoringEnabled", event.target.checked)}
            />
            全局启用摄像头监考
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">截图间隔（秒）</span>
            <input
              className="w-full rounded-md border px-3 py-2"
              type="number"
              min={5}
              max={60}
              step={1}
              value={settings.proctoringIntervalSeconds}
              onChange={(event) => update("proctoringIntervalSeconds", Number(event.target.value))}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">违规置信度阈值</span>
            <input
              className="w-full rounded-md border px-3 py-2"
              type="number"
              min={0.5}
              max={1}
              step={0.01}
              value={settings.proctoringConfidenceThreshold}
              onChange={(event) =>
                update("proctoringConfidenceThreshold", Number(event.target.value))
              }
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={testVisionConnection} disabled={busy}>
            {testingVision ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ServerCog className="mr-2 h-4 w-4" />
            )}
            测试视觉输入
          </Button>
          <span className="text-xs text-slate-500">测试图片为固定非个人样例。</span>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <div className="mb-5 flex items-start gap-3">
          <div className="rounded-lg bg-sky-50 p-2 text-sky-600">
            <ServerCog size={20} />
          </div>
          <div>
            <h3 className="font-semibold">面试默认规则</h3>
            <p className="mt-1 text-sm text-slate-500">
              新岗位会使用这里的默认时长；已有岗位的时长不会被自动覆盖。
            </p>
          </div>
        </div>
        <label className="block max-w-sm space-y-1 text-sm">
          <span className="font-medium">新岗位默认面试时长（分钟）</span>
          <input
            className="w-full rounded-md border px-3 py-2"
            type="number"
            min={1}
            max={60}
            step={1}
            value={settings.defaultInterviewDuration}
            onChange={(event) => update("defaultInterviewDuration", Number(event.target.value))}
          />
        </label>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          建议标准初筛使用 20 至 30 分钟；1 至 10 分钟适合快速验证，正式面试不建议使用过短时长。
        </p>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 md:p-5">
        <h3 className="font-semibold">内部使用提醒</h3>
        <p className="mt-1 leading-6">
          当前系统面向公司内部单租户使用。实时语音浏览器直连方案会把实时语音密钥交给候选人端；正式对外使用前应改为服务端
          WebSocket 代理或服务商临时令牌方案。
        </p>
      </section>
    </div>
  );
}

export default SettingsForm;
