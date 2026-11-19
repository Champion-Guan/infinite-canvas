/**
 * 画布性能优化补丁
 *
 * 优化内容：
 * 1. 在拖动/缩放时使用简化节点渲染，减少 DOM 操作和重绘
 * 2. 简化版节点只显示边框和基础内容，无交互元素
 * 3. 预期提升拖动帧率 50-70%
 *
 * 应用位置：web/src/pages/canvas/project.tsx
 * 插入位置：节点渲染循环中，CanvasNode 之前
 */

// 在文件顶部添加导入
import { SimplifiedCanvasNode } from "@/上游适配/简化节点渲染补丁";

// 在节点渲染部分修改（约 3297 行）
// 原代码：
//   {residentCanvasNodes.map((node) => !mountedVisibleNodes.has(node.id) || hasDeferredCanvasMedia(node) ? (
//       <CanvasMediaPlaceholder key={node.id} node={node} />
//   ) : (
//       <CanvasNode key={node.id} data={node} {...props} />
//   ))}

// 修改为：
{residentCanvasNodes.map((node) => {
    // 判断是否需要简化渲染
    const shouldSimplify = (isCanvasPanning || isNodeResizing) &&
                          visibleNodeIds.has(node.id) &&
                          mountedVisibleNodes.has(node.id) &&
                          !hasDeferredCanvasMedia(node);

    // 简化渲染：拖动/缩放时只显示边框和缩略图
    if (shouldSimplify) {
        return (
            <SimplifiedCanvasNode
                key={node.id}
                data={node}
                scale={viewport.k}
                isSelected={selectedNodeIds.has(node.id)}
            />
        );
    }

    // 媒体占位符：未挂载或媒体延迟加载
    if (!mountedVisibleNodes.has(node.id) || hasDeferredCanvasMedia(node)) {
        return <CanvasMediaPlaceholder key={node.id} node={node} />;
    }

    // 完整渲染：正常状态
    return (
        <CanvasNode
            key={node.id}
            data={node}
            endpointTarget={cardEndpointTarget}
            panelTarget={cardPanelTarget}
            isConnectionObscured={obscuredResultIds.has(node.id)}
            scale={viewport.k}
            isInViewport={visibleNodeIds.has(node.id)}
            isViewInteracting={isCanvasPanning}
            isSelected={selectedNodeIds.has(node.id)}
            isRelated={relatedHighlight.nodeIds.has(node.id) || connectionFocus.nodeIds.has(node.id) || connectionPreviewNodeIds.has(node.id)}
            isFocusRelated={activeNodeId === node.id}
            isConnectionTarget={connectionTargetNodeId === node.id}
            isConnecting={Boolean(connectingParams)}
            referenceSelectionState={!referencePickerNodeId ? undefined : node.id === referencePickerNodeId ? "target" : referenceConnectedNodeIds.has(node.id) || !isCanvasReferenceNode(node, nodes) ? "disabled" : "available"}
            showPanel={!isNodeResizing && dialogNodeId === node.id && !selectionBox && !getNodeDefinition(node.type)?.hidePanel}
            groupChildCount={groupChildCountById.get(node.id) || 0}
            isGroupDropTarget={dropTargetGroupId === node.id}
            batchExpanded={expandedBatchNodeIds.has(node.id)}
            showImageInfo={showImageInfo}
            mentionReferences={mentionReferencesByNodeId.get(node.id) || EMPTY_REFERENCES}
            pluginHost={pluginHost}
            registryVersion={nodeRegistryVersion}
            promptHighlightSource={node.metadata?.promptVariableSourceNodeId
                ? nodeById.get(node.metadata.promptVariableSourceNodeId)
                : node.metadata?.promptVariableTranslationOf
                  ? (() => {
                      const translatedFrom = nodeById.get(node.metadata.promptVariableTranslationOf);
                      const sourceId = translatedFrom?.metadata?.promptVariableSourceNodeId;
                      return nodeById.get(sourceId || node.metadata.promptVariableTranslationOf);
                  })()
                  : undefined}
            promptHighlightParameters={node.metadata?.promptVariablePreviewOf
                ? nodeById.get(node.metadata.promptVariablePreviewOf)
                : node.metadata?.promptVariableTranslationOf
                  ? (() => {
                      const translatedFrom = nodeById.get(node.metadata.promptVariableTranslationOf);
                      const parameterId = translatedFrom?.metadata?.promptVariablePreviewOf;
                      return parameterId ? nodeById.get(parameterId) : undefined;
                  })()
                  : undefined}
            renderPanel={renderNodePanel}
            renderNodeContent={renderNodeContentPanel}
            onMouseDown={handleNodeMouseDown}
            onSelectCapture={handleNodeSelectCapture}
            onHoverStart={handleNodeHoverStart}
            onRequestFocus={focusNode}
            onHoverEnd={handleNodeHoverEnd}
            onConnectStart={handleConnectStart}
            onResizeStart={handleNodeResizeStart}
            onResize={handleNodeResize}
            onResizeEnd={handleNodeResizeEnd}
            onContentChange={handleNodeContentChange}
            onTitleChange={handleNodeTitleChange}
            onToggleBatch={toggleBatchExpanded}
            onSetBatchPrimary={setBatchPrimary}
            onDuplicateBatchImage={duplicateBatchImage}
            onDownloadBatchImage={downloadBatchImage}
            onRetryBatchImage={retryBatchImage}
            onDeleteBatchImage={deleteBatchImage}
            onRetry={handleNodeRetry}
            onViewImage={handleNodeViewImage}
            onSelectReference={selectNodeReference}
            onContextMenu={handleNodeContextMenu}
        />
    );
})}

/**
 * 优化效果：
 * - 拖动时节点数量：169 个
 * - 简化渲染节点：约 20-30 个（视区内可见）
 * - 完整渲染节点：0 个（拖动时全部降级）
 * - 预期帧率提升：从 15-20 FPS 到 40-50 FPS
 */
