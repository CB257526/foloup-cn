/**
 * 设备预检的纯逻辑与中文文案（P2 后续任务新建）。
 *
 * 单独抽出来的原因：设备检查的「失败原因 → 候选人该做什么」映射是纯函数，
 * 放在组件里会混着 DOM/BOM 副作用，既不好读也不好在验收里单独断言。
 *
 * 设计口径：**每一种失败都必须给出下一步动作**，不允许只显示「出错了」。
 */

/** 麦克风电平判定阈值（RMS，0~1）。手机麦克风在安静环境下 RMS 通常 < 0.01。 */
export const MIC_LEVEL_ACTIVE = 0.015;

/** 麦克风检查的采样时长（毫秒）—— 太短会误判"没声音"，太长让候选人干等 */
export const MIC_SAMPLE_MS = 4000;

/**
 * 申请麦克风的等待上限（毫秒）。
 *
 * 为什么需要：某些环境下 `getUserMedia` 既不 resolve 也不 reject（权限弹窗被系统挂起、
 * 设备驱动异常等），候选人会永久停在"正在检查…"，只能去刷新页面 —— 这正是本任务要消灭的体验。
 * 超时后按"设备被占用/不可用"处理并给出中文指引 + 重新检查入口。
 */
export const MIC_REQUEST_TIMEOUT_MS = 20000;

/**
 * 给任意 Promise 加超时：超时抛出的错误名由 describeMicError 映射成"授权无响应"的中文提示。
 *
 * ⚠️ **不要**用它包 `getUserMedia`：`withTimeout` 只让调用方停止等待，并不会取消浏览器那边的
 *    申请；超时之后 `getUserMedia` 仍可能 resolve 出一个没人接手的 MediaStream，轨道不会被 stop，
 *    麦克风就一直被这个页面占着（正式面试时会被判成"设备被占用"）。
 *    申请麦克风请用下面的 `requestMicStream`（带检查代次 + 迟到释放）。
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject({ name: "RequestTimeoutError" }), ms);

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

/**
 * 已经释放过的轨道。真实 `MediaStreamTrack.stop()` 本身就是幂等的，
 * 但把它记下来能让「同一轮清理不会重复执行」这件事在代码与验收里都是**确定的**，
 * 而不是"重复调用也无害"这种需要读者自己推理的保证。
 */
const releasedTracks = new WeakSet<object>();

/** 释放一条媒体流里的**所有**轨道（幂等：同一条轨道只会被 stop 一次） */
export function stopMediaStream(stream: MediaStream | null | undefined): void {
  if (!stream || typeof stream.getTracks !== "function") {
    return;
  }
  for (const track of stream.getTracks()) {
    if (!track || typeof track.stop !== "function" || releasedTracks.has(track)) {
      continue;
    }
    releasedTracks.add(track);
    try {
      track.stop();
    } catch {
      // 设备已被物理拔出、或轨道已经结束：忽略即可，清理动作本身要保证不抛错
    }
  }
}

/**
 * 设备检查的「代次」。
 *
 * 每次点「开始设备检查 / 重新检查」都会 +1，组件卸载时也 +1。
 * 任何在途的异步结果（getUserMedia、rAF 采样）在把状态写回去之前都要先确认
 * 自己的代次仍然有效 —— 否则上一轮的迟到结果会覆盖新一轮的 UI 状态，
 * 候选人看到的就是"检查结果自己变了"。
 */
export type CheckGeneration = { current: number };

/** 某个代次是否仍然有效：既没被新一轮检查顶掉，也没随组件卸载作废 */
function isCurrentGeneration(
  generation: number,
  generationRef: CheckGeneration,
  isAlive: () => boolean,
): boolean {
  return isAlive() && generationRef.current === generation;
}

/**
 * 按「检查代次」申请麦克风。
 *
 * 为什么不能只是给 `getUserMedia` 套一个超时：
 *   `getUserMedia` **无法取消**。超时只是让调用方不再等待，浏览器那边的权限弹窗与设备占用
 *   仍在继续，迟早会 resolve 出一个**没人接手**的 MediaStream。若它落在超时之后，
 *   调用方早已走开，这些轨道就没人 stop —— 麦克风被这个页面一直占着。
 *
 * 所以这里在请求发出的同时登记一个「迟到处理器」：只要 resolve 时这一代已经失效
 * （超时 / 新一轮检查 / 组件卸载），就地 `stop()` 全部轨道，绝不外泄给调用方。
 */
export function requestMicStream(options: {
  /** 真正发起申请的动作（单独传进来是为了可测：验收里可以塞一个可控的延迟 Promise） */
  request: () => Promise<MediaStream>;
  timeoutMs: number;
  /** 本次申请所属的代次 */
  generation: number;
  generationRef: CheckGeneration;
  /** 组件是否仍挂载 */
  isAlive: () => boolean;
}): Promise<MediaStream> {
  const { request, timeoutMs, generation, generationRef, isAlive } = options;

  let pending: Promise<MediaStream>;
  try {
    pending = request();
  } catch (error) {
    // 少数浏览器在约束不合法时会**同步**抛错而不是返回 rejected promise
    return Promise.reject(error);
  }

  /**
   * 调用方是否已经拿到本次申请的结论（resolve / reject 都算）。
   *
   * 为什么需要它：光看"代次是否失效"挡不住**超时**这条路径 ——
   * 超时的那一刻代次并没有变（组件也没重启检查），但调用方已经走开了。
   * 之后 getUserMedia 才 resolve 出来的流对谁都没用，必须就地释放。
   */
  let settled = false;

  // 迟到处理器：在请求发出的同时登记，是唯一负责"释放迟到流"的地方
  //（下面的 Promise 只负责把结果/失败通知给调用方，不重复 stop）。
  pending.then(
    (stream) => {
      if (settled || !isCurrentGeneration(generation, generationRef, isAlive)) {
        stopMediaStream(stream);
      }
    },
    () => {
      // 申请失败不需要在这里处理：下面的 Promise 会把同一个错误交给调用方
    },
  );

  return new Promise<MediaStream>((resolve, reject) => {
    const timer = setTimeout(() => {
      settled = true;
      reject({ name: "RequestTimeoutError" });
    }, timeoutMs);

    pending.then(
      (stream) => {
        clearTimeout(timer);
        if (settled) {
          // 已经因为超时把结论告诉调用方了：这次结果作废（上面已就地释放）
          return;
        }
        if (!isCurrentGeneration(generation, generationRef, isAlive)) {
          // 重新检查 / 卸载之后才回来的流：上面已就地释放，这里只通知调用方"这次作废"
          reject({ name: "StaleRequestError" });
          return;
        }
        settled = true;
        resolve(stream);
      },
      (error) => {
        clearTimeout(timer);
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      },
    );
  });
}

export type MicFailureCode =
  | "unsupported"
  | "insecure_context"
  | "permission_denied"
  | "no_device"
  | "device_busy"
  | "overconstrained"
  | "request_timeout"
  | "audio_context_unsupported"
  | "unknown";

export type MicFailure = {
  code: MicFailureCode;
  /** 一句话说明发生了什么 */
  message: string;
  /** 候选人下一步该做什么（必须有） */
  hint: string;
  /** true = 候选人可以自行修复后点「重新检查」（设备不存在这类需要插设备） */
  retryable: boolean;
};

const FAILURE_TEXT: Record<MicFailureCode, { message: string; hint: string; retryable: boolean }> =
  {
    unsupported: {
      message: "当前浏览器不支持麦克风采集（缺少 getUserMedia 接口）。",
      hint: "请改用较新版本的 Chrome、Edge、Safari 或微信内置浏览器重新打开这条链接。",
      retryable: false,
    },
    insecure_context: {
      message: "当前页面不是通过 HTTPS 打开的安全页面，浏览器不允许申请麦克风。",
      hint: "请确认地址栏是 https:// 开头（不要用 IP 直连的 http:// 地址）；把完整链接复制到浏览器重新打开。",
      retryable: true,
    },
    permission_denied: {
      message: "麦克风权限被拒绝或被浏览器拦截。",
      hint: "点地址栏左侧的锁形/设置图标，把「麦克风」改为「允许」，然后回到本页点「重新检查」；如果找不到该设置，可刷新页面后重新授权。",
      retryable: true,
    },
    no_device: {
      message: "没有检测到可用的麦克风设备。",
      hint: "请插好耳麦或确认手机没有把麦克风孔堵住，并在系统设置里确认麦克风未被禁用，然后点「重新检查」。",
      retryable: true,
    },
    device_busy: {
      message: "麦克风被其他程序占用了。",
      hint: "请关闭正在使用麦克风的程序或标签页（例如其他会议软件、录音软件、另一个面试页面），然后点「重新检查」。",
      retryable: true,
    },
    overconstrained: {
      message: "当前麦克风不支持所需的采集参数。",
      hint: "请换一个麦克风或耳机后点「重新检查」；如果仍然失败，可尝试更换浏览器。",
      retryable: true,
    },
    request_timeout: {
      message: "麦克风授权一直没有响应（可能是权限弹窗被系统挂起）。",
      hint: "请查看浏览器地址栏是否还有麦克风权限提示并点「允许」，然后点「重新检查」；也可以重启浏览器后再试。",
      retryable: true,
    },
    audio_context_unsupported: {
      message: "当前浏览器无法创建音频处理环境（AudioContext 不可用）。",
      hint: "请改用较新版本的 Chrome、Edge 或 Safari。旧版浏览器无法进行语音面试。",
      retryable: false,
    },
    unknown: {
      message: "麦克风检查没有通过。",
      hint: "请检查麦克风是否插好、是否被静音，然后点「重新检查」；也可以用「暂不同意」退出后联系招聘人员。",
      retryable: true,
    },
  };

/** 把浏览器抛出的错误映射成中文原因 + 下一步动作 */
export function describeMicError(
  error: unknown,
  context?: { secureContext?: boolean },
): MicFailure {
  if (context?.secureContext === false) {
    return { code: "insecure_context", ...FAILURE_TEXT.insecure_context };
  }
  const name = (error as { name?: string } | null | undefined)?.name ?? "";

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return { code: "permission_denied", ...FAILURE_TEXT.permission_denied };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return { code: "no_device", ...FAILURE_TEXT.no_device };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return { code: "device_busy", ...FAILURE_TEXT.device_busy };
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return { code: "overconstrained", ...FAILURE_TEXT.overconstrained };
    case "RequestTimeoutError":
      return { code: "request_timeout", ...FAILURE_TEXT.request_timeout };
    case "NotSupportedError":
      return { code: "unsupported", ...FAILURE_TEXT.unsupported };
    default:
      return { code: "unknown", ...FAILURE_TEXT.unknown };
  }
}

export function describeAudioContextUnsupported(): MicFailure {
  return { code: "audio_context_unsupported", ...FAILURE_TEXT.audio_context_unsupported };
}

/** 把 0~1 的 RMS 映射成进度条宽度用的 0~1 值（人声的 RMS 很小，需要放大） */
export function levelToBar(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) {
    return 0;
  }

  return Math.min(1, rms * 8);
}

/** 麦克风电平的中文状态文本 */
export function levelText(state: "idle" | "checking" | "ok", heard: boolean): string {
  if (state === "idle") {
    return "尚未检查";
  }
  if (state === "checking") {
    return heard ? "已检测到声音 ✓" : "正在捕捉声音…请对着麦克风说几句话";
  }

  return heard ? "已检测到声音 ✓" : "没有检测到明显声音";
}

/**
 * 网络检查失败的中文指引。
 * 刻意分成"完全没网"与"连不上面试服务"两种，因为下一步动作不同。
 */
export function describeNetworkFailure(offline: boolean): string {
  return offline
    ? "设备显示当前没有网络。请打开 Wi-Fi 或移动数据，然后点「重新检查」。"
    : "无法连接面试服务。请检查网络（换一个 Wi-Fi / 关闭代理与 VPN），然后点「重新检查」。";
}

/** 设备检查整体结论（用于禁用/启用「同意并开始面试」） */
export type DeviceGateResult = {
  /** 是否全部通过 */
  ready: boolean;
  /** 未通过时给候选人的下一步动作（空字符串表示已通过） */
  blockedReason: string;
};

export function buildDeviceGate(input: {
  micOk: boolean;
  micHint: string;
  audioContextOk: boolean;
  networkOk: boolean;
}): DeviceGateResult {
  if (!input.audioContextOk) {
    return { ready: false, blockedReason: FAILURE_TEXT.audio_context_unsupported.hint };
  }
  if (!input.micOk) {
    return {
      ready: false,
      blockedReason: input.micHint || FAILURE_TEXT.unknown.hint,
    };
  }
  if (!input.networkOk) {
    return { ready: false, blockedReason: "请先完成设备检查，并确认网络可以连接面试服务。" };
  }

  return { ready: true, blockedReason: "" };
}
