/** 大模型的默认接入参数，与运行时可配置项分开，避免仓储模块反向依赖 LLM 客户端。 */
export const DEFAULT_LLM_BASE_URL = "https://maas.qianwenaiapi.com/compatible-mode/v1";
export const DEFAULT_LLM_MODEL = "deepseek-v4.1-flash";
export const DEFAULT_LLM_MAX_TOKENS = 4000;
