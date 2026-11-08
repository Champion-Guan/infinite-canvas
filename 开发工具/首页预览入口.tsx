// 仅用于隔离候选验收，不进入产品包，不加载旧数据或真实API。
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";
import { CanvasEntry } from "../扩展功能/首页/画布入口候选";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

function PreviewCanvas() {
    const { id } = useParams();
    const project = useCanvasStore((state) => state.projects.find((item) => item.id === id));
    const count = useCanvasStore((state) => state.projects.length);
    return <main data-testid="preview-canvas" data-project-id={id} data-project-count={count}>
        <h1>{project?.title}</h1><p>候选验收：已创建画布并跳转；此页不是实际画布工作区。</p>
    </main>;
}

createRoot(document.getElementById("root")!).render(<BrowserRouter>
    <Routes><Route path="/" element={<CanvasEntry />} /><Route path="/canvas/:id" element={<PreviewCanvas />} /></Routes>
</BrowserRouter>);
