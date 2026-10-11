"use client";

import {
  getAppSettingsAction,
  saveAppSettingsAction,
  testLlmConnectionAction,
} from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Eye, EyeOff, Loader2, Save, ServerCog } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type SettingsSnapshot = {
  llmBaseUrl: string;
  llmModel: string;
  llmMaxTokens: number;
  llmTimeoutMs: number;
  llmJsonMode: boolean;
  realtimeModel: string;
  defaultInterviewDuration: number;
  apiKeyConfigured: boolean;
};

type FormState = Omit<SettingsSnapshot, "apiKeyConfigured"> & { apiKey: string };

interface Props {
  initialSettings: SettingsSnapshot;
}

function SettingsForm({ initialSettings }: Props) {
  const [settings, setSettings] = useState<FormState>({
    ...initialSettings,
    apiKey: "",
  });
  const [apiKeyConfigured, setApiKeyConfigured] = useState(initialSettings.apiKeyConfigured);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const next = await saveAppSettingsAction({ ...settings });
      setSettings((current) => ({ ...current, ...next, apiKey: "" }));
      setApiKeyConfigured(next.apiKeyConfigured);
      toast.success("系统设置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败，请检查设置内容");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const result = await testLlmConnectionAction({
        llmBaseUrl: settings.llmBaseUrl,
        llmModel: settings.llmModel,
        llmMaxTokens: settings.llmMaxTokens,
        llmTimeoutMs: settings.llmTimeoutMs,
        llmJsonMode: settings.llmJsonMode,
        apiKey: settings.apiKey,
      });
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "连接测试失败");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">系统设置</h2>
          <p className="mt-1 text-sm text-slate-500">
            配置模型、语音面试默认规则和内部数据使用方式。修改保存后，新面试立即使用新配置。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={testConnection}
            disabled={testing || saving}
          >
            {testing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ServerCog className="mr-2 h-4 w-4" />
            )}
            测试文本模型
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={saving || testing}
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
              用于自动出题、候选人评分和岗位洞察，兼容 OpenAI 接口格式。
            </p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium">接口地址</span>
            <input
              className="w-full rounded-md border px-3 py-2"
              value={settings.llmBaseUrl}
              onChange={(event) => update("llmBaseUrl", event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">模型名称</span>
            <input
              className="w-full rounded-md border px-3 py-2"
              value={settings.llmModel}
              onChange={(event) => update("llmModel", event.target.value)}
              placeholder="例如 deepseek-v4.1-flash"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">平台 API 密钥</span>
            <div className="relative">
              <input
                className="w-full rounded-md border px-3 py-2 pr-10"
                type={showApiKey ? "text" : "password"}
                value={settings.apiKey}
                onChange={(event) => update("apiKey", event.target.value)}
                placeholder={apiKeyConfigured ? "已配置，留空表示保持不变" : "请输入平台 API 密钥"}
              />
              <button
                type="button"
                aria-label={showApiKey ? "隐藏 API 密钥" : "显示 API 密钥"}
                className="absolute right-2 top-2 text-slate-500"
                onClick={() => setShowApiKey((visible) => !visible)}
              >
                {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
              <CheckCircle2 size={14} />{" "}
              {apiKeyConfigured ? "服务端已配置，不会在页面回显" : "尚未配置"}
            </span>
          </label>
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
            <ServerCog size={20} />
          </div>
          <div>
            <h3 className="font-semibold">实时语音面试</h3>
            <p className="mt-1 text-sm text-slate-500">
              候选人开始面试时使用；API 密钥仍由服务端签发，不在设置页面展示。
            </p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium">实时语音模型</span>
            <input
              className="w-full rounded-md border px-3 py-2"
              value={settings.realtimeModel}
              onChange={(event) => update("realtimeModel", event.target.value)}
              placeholder="例如 qwen3.8-omni-flash-realtime"
            />
          </label>
          <label className="space-y-1 text-sm">
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
        </div>
        <p className="mt-4 text-xs text-slate-500">
          建议标准初筛使用 20 至 30 分钟；1 至 10 分钟适合快速验证，不建议作为正式面试默认值。
        </p>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 md:p-5">
        <h3 className="font-semibold">内部使用提醒</h3>
        <p className="mt-1 leading-6">
          当前系统面向公司内部单租户使用。上线前仍应补充后台访问保护、候选人同意记录的服务端审计，以及到期数据自动删除任务。
        </p>
      </section>
    </div>
  );
}

export default SettingsForm;
