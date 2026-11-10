import { Settings2, Languages } from "lucide-react";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { PROMPT_VARIABLES_NODE_TYPE, promptVariablesResource } from "./旧版参数规则";
import { PromptVariablesContent } from "./旧版参数卡片";
import { ProductPromptContent } from "./商品提示词卡片";
import { isPromptReady, PRODUCT_PROMPT_NODE_TYPE, promptDocument, promptPair } from "./商品提示词规则";
import { factTokens } from "./商品待确认规则";
export function registerExcelParameterNode() {
registerNodeDefinitions([{ type: PROMPT_VARIABLES_NODE_TYPE, title: "产品参数设置", description: "产品参数设置", icon: <Settings2 className="size-4" />, minimapColor: "#14b8a6", Content: PromptVariablesContent, resource: promptVariablesResource, hidePanel: true, showInCreateMenu: false, defaultSize: { width: 420, height: 520 }, defaultMetadata: { status: "success" } }]);
registerNodeDefinitions([{ type: PRODUCT_PROMPT_NODE_TYPE, title: "商品图片提示词", description: "中英文商品图片提示词", icon: <Languages className="size-4" />,
    minimapColor: "#2b967a", Content: ProductPromptContent, resource: node => {
        const doc = promptDocument(node), pair = doc && promptPair(doc);
        return { kind: "text", text: isPromptReady(pair) && !factTokens(pair!.english).length ? pair!.english : "" };
    }, hidePanel: true, showInCreateMenu: false, defaultSize: { width: 440, height: 540 }, defaultMetadata: { status: "success" } }]);
}
