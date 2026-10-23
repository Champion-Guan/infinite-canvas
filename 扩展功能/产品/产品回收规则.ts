import type { CanvasProject, CanvasDeletedProject } from "@/stores/canvas/use-canvas-store";
import { canvasTaskSummary } from "./产品任务摘要.js";
import { orderedProducts } from "./产品规则";

export type RecycledProduct = CanvasDeletedProject & {
  project: CanvasProject;
  nextProductId: string;
};
type ProductState = {
  projects: CanvasProject[];
  deletedProjects: CanvasDeletedProject[];
};

export function recycledProducts(state: ProductState): RecycledProduct[] {
  return state.deletedProjects.filter((entry): entry is RecycledProduct =>
    Boolean(entry.project && entry.project.id === entry.id),
  );
}

// 旧版先右邻、再左邻；不因updatedAt或数组倒序误选产品。
export function planProductRecycle(state: ProductState, id: string, deletedAt: string): ProductState {
  const project = state.projects.find((item) => item.id === id);
  if (!project) {
    if (recycledProducts(state).some((entry) => entry.id === id)) return state;
    throw new Error("该产品已不存在，请刷新后重试。");
  }
  if (canvasTaskSummary(project.nodes, project.connections).status === "loading")
    throw new Error("该产品有生成任务运行中，请等待任务结束后再删除。");
  const ids = orderedProducts(state.projects).map((item) => item.id), index = ids.indexOf(id);
  const entry: RecycledProduct = {
    id, deletedAt, project: structuredClone(project),
    nextProductId: ids[index + 1] || ids[index - 1] || "",
  };
  // 同一canvas_store根的原子一代同时带回收快照和移除结果；不删除媒体。
  return {
    projects: state.projects.filter((item) => item.id !== id),
    deletedProjects: [...state.deletedProjects.filter((item) => item.id !== id), entry],
  };
}

export function planProductRestore(state: ProductState, id: string): ProductState {
  const archived = recycledProducts(state).find((entry) => entry.id === id);
  const current = state.projects.find((item) => item.id === id);
  if (current) {
    if (archived) throw new Error("当前产品和回收站有相同ID，为保护数据已停止恢复。");
    return state; // 上次已落盘但ACK丢失后的幂等重试，不覆盖已恢复产品。
  }
  if (!archived) throw new Error("没有可恢复的完整画布，未把旧删除标记当作备份。");
  return {
    projects: [structuredClone(archived.project), ...state.projects],
    deletedProjects: state.deletedProjects.filter((item) => item.id !== id),
  };
}

export function projectsWithRecycleMedia(state: ProductState): CanvasProject[] {
  return [...state.projects, ...recycledProducts(state).map((entry) => entry.project)];
}
