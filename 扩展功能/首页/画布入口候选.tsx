import { Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { entryProjectId } from "@/guan/功能开关";
import { WorkbenchHome } from "./工作台首页";

// 仅替换自有空白入口；已有画布仍按已批准逻辑进入，不迁旧产品、Excel或数据。
export function CanvasEntry() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const hydrated = useCanvasStore((state) => state.hydrated);
  const projects = useCanvasStore((state) => state.projects);
  const createProject = useCanvasStore((state) => state.createProject);
  const theme = useThemeStore((state) => state.theme);
  const id = entryProjectId(projects);

  if (!hydrated)
    return (
      <main
        className="grid h-full place-items-center bg-background text-foreground"
        role="status"
      >
        {t("canvas.opening")}
      </main>
    );
  if (id) return <Navigate to={`/canvas/${encodeURIComponent(id)}`} replace />;

  return (
    <WorkbenchHome
      theme={theme}
      onCreate={() => {
        const projectId = createProject(t("canvas.defaultTitle", { count: 1 }));
        navigate(`/canvas/${encodeURIComponent(projectId)}`, { replace: true });
      }}
    />
  );
}
