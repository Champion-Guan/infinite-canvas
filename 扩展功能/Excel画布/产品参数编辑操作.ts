import { useCallback } from "react";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { CanvasNodeMetadata } from "@/types/canvas";
import { saveProductParameterValues } from "./Excel参数记忆";
import { buildProductParameterEdits } from "./产品参数联动";

// 每次输入读取当前节点，复用原画布事务、撤销和保存，不另建表单状态。
export function useProductParameterEditing(ctx: CanvasNodeContext, productId: string, tokens: string[]) {
    const update = useCallback((patch: CanvasNodeMetadata) => {
        const ops = buildProductParameterEdits(ctx.getNodes(), ctx.getConnections(), ctx.node.id, patch);
        if (ops.length) ctx.applyOps(ops);
    }, [ctx]);
    const updateValue = useCallback((token: string, value: string) => {
        const current = ctx.getNode(ctx.node.id);
        if (!current) return;
        saveProductParameterValues(productId, { [token]: value });
        update({ promptVariableValues: { ...current.metadata?.promptVariableValues, [token]: value }, promptVariableTokens: tokens });
    }, [ctx, productId, tokens, update]);
    const updateSupplement = useCallback((value: string) => update({ promptVariableSupplement: value }), [update]);
    return { updateValue, updateSupplement };
}
