import { Settings2 } from "lucide-react";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { PROMPT_VARIABLES_NODE_TYPE, promptVariablesResource } from "./旧版参数规则";
import { PromptVariablesContent } from "./旧版参数卡片";
export function registerExcelParameterNode() {
registerNodeDefinitions([{ type: PROMPT_VARIABLES_NODE_TYPE, title: "产品参数设置", description: "产品参数设置", icon: <Settings2 className="size-4" />, minimapColor: "#14b8a6", Content: PromptVariablesContent, resource: promptVariablesResource, hidePanel: true, showInCreateMenu: false, defaultSize: { width: 420, height: 520 }, defaultMetadata: { status: "success" } }]);
}
