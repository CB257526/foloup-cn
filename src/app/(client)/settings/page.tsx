import SettingsForm from "@/components/settings/settingsForm";
import { getAppSettings } from "@/lib/data/settings";

/** 设置页必须读取最新数据库配置，避免静态页面展示旧模型。 */
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <main className="min-w-0 p-4 md:p-8">
      <SettingsForm initialSettings={getAppSettings()} />
    </main>
  );
}
