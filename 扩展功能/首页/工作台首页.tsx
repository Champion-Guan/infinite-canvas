import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEmblaCarousel, Autoplay } from "./轮播依赖.js";
import styles from "./首页.module.css";
import { ProductTrashEntry } from "../产品/产品回收面板";

// 来源：旧 canvas.js/showEmptyProducts 和 9803 chunk/45199 的 M/T/E/V。
// 保留原 DOM 层次、尺寸、图片框、叠加标签和 Embla 协议；只适配资源路径与事件出口。
const groups = ["游戏手柄", "运动鞋", "智能手表"];
const imageUrl = (group: number, kind: string, index: number) => `/guan/首页轮播/第${group}组-${kind}${index}.webp`;
const sourceCorners = ["flex-1 rounded-t-[16px]", "flex-1", "flex-1 rounded-b-[16px]"];
const resultCorners = ["rounded-tl-[16px]", "rounded-tr-[16px]", "", "", "rounded-bl-[16px]", "rounded-br-[16px]"];

function PreviewImage({ src, alt, className = "", contain = false }: { src: string; alt: string; className?: string; contain?: boolean }) {
  return <div className={`relative min-h-0 min-w-0 overflow-hidden ${className}`}>
    <img src={src} alt={alt} draggable={false} decoding="async" className={`absolute inset-0 size-full ${contain ? "object-contain" : "object-cover"}`} />
  </div>;
}
function Label({ children }: { children: string }) {
  return <span data-slot="badge" className="absolute top-2 left-1/2 z-10 -translate-x-1/2 rounded-full border-0 px-1.5 py-0.5 text-xs leading-4 font-normal whitespace-nowrap">{children}</span>;
}
function DetailPageTemplate({ group }: { group: number }) {
  return <div data-slot="card" aria-label="详情页轮播模板" className="bg-surface-muted flex w-full max-w-172 aspect-688/368 flex-col items-center justify-center overflow-hidden rounded-[32px] border-0 p-4 shadow-none ring-0 max-[760px]:aspect-auto">
    <div data-slot="card-content" className="grid w-full grid-cols-[104px_40px_94px_382px] items-center justify-center gap-3 p-0 max-[760px]:grid-cols-1 max-[760px]:gap-4">
      <div className="relative aspect-104/336 w-[104px] shrink-0 overflow-hidden rounded-[16px] border-0 bg-transparent p-0 shadow-none ring-0 max-[760px]:mx-auto max-[760px]:w-[30%]">
        <div className="flex size-full flex-col gap-1">{[1, 2, 3].map((number) => <PreviewImage key={number} src={imageUrl(group, "商品图", number)} alt={`产品图 ${number}`} className={sourceCorners[number - 1]} />)}</div>
        <Label>产品图</Label>
      </div>
      <div className="flex h-full items-center justify-center max-[760px]:h-10 max-[760px]:rotate-90"><img src="/guan/首页原样资源/轮播箭头.svg" alt="" aria-hidden="true" className="h-6 w-10 shrink-0" /></div>
      <div className="relative aspect-94/336 w-[94px] shrink-0 overflow-hidden rounded-[16px] border-0 p-0 shadow-none ring-0 max-[760px]:mx-auto max-[760px]:w-[28%]">
        <PreviewImage src={imageUrl(group, "详情长图", 1)} alt="电商长图" className="absolute inset-0 size-full" /><Label>电商长图</Label>
      </div>
      <div className="flex h-full w-[382px] items-start pl-6 max-[760px]:w-full max-[760px]:justify-center max-[760px]:pl-0">
        <div className="relative aspect-358/336 w-full shrink-0 overflow-hidden rounded-[16px] border-0 bg-transparent p-0 shadow-none ring-0 max-[760px]:mx-auto">
          <div className="grid size-full grid-cols-2 grid-rows-3 gap-x-2 gap-y-1.5">{[1, 2, 3, 4, 5, 6].map((number) => <PreviewImage key={number} src={imageUrl(group, "效果图", number)} alt={`平台规范图 ${number}`} className={resultCorners[number - 1]} contain />)}</div><Label>符合多电商平台规范</Label>
        </div>
      </div>
    </div>
  </div>;
}
type Props = { theme: "light" | "dark"; onCreate: () => void; onImportProduct: (file: File) => void; busy?: boolean };
export function WorkbenchHome({ theme, onCreate, onImportProduct, busy = false }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const plugins = useMemo(() => [Autoplay({ delay: 5000, stopOnInteraction: false })], []);
  const [carouselRef, api] = useEmblaCarousel({ loop: true, watchResize: false }, plugins);
  const [index, setIndex] = useState(0);
  const select = useCallback(() => { if (api) setIndex(api.selectedScrollSnap()); }, [api]);
  useEffect(() => {
    if (!api) return;
    api.on("select", select).on("reInit", select);
    return () => { api.off("select", select).off("reInit", select); };
  }, [api, select]);
  useEffect(() => {
    const element = root.current;
    if (!api || !element) return;
    let width = element.getBoundingClientRect().width;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      clearTimeout(timer);
      timer = setTimeout(() => api.reInit(), 150);
    });
    observer.observe(element);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [api]);
  const pending = "选择画布压缩包，新建产品并导入其内容。";
  return <main className={styles.page} data-theme={theme} aria-label="工作台首页">
    <div className="guan-product-empty">
      <section className="guan-product-landing-preview" aria-labelledby="guan-home-title">
        <div className="guan-product-landing-introduction"><h1 id="guan-home-title">A+ 详情页</h1><p>上传商品图，AI 即刻生成符合多电商平台规范的高转化率商品图。</p></div>
        <div ref={root} role="region" aria-roledescription="carousel" aria-label="轮播模板预览" className="relative w-full" onKeyDownCapture={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); if (event.key === "ArrowLeft") api?.scrollPrev(); else api?.scrollNext(); }
        }}>
          <div ref={carouselRef} className="overflow-hidden" data-slot="carousel-content"><div className="flex ml-0 items-center">{groups.map((name, i) => <div key={name} data-slot="carousel-item" role="group" aria-roledescription="slide" aria-label={`${i + 1} / 3：${name}`} className="min-w-0 shrink-0 grow-0 basis-full flex justify-center pl-0"><DetailPageTemplate group={i + 1} /></div>)}</div></div>
        </div>
        <div aria-label="轮播图导航">{groups.map((name, i) => <button key={name} type="button" aria-label={`切换到第 ${i + 1} 个轮播模板`} aria-current={index === i ? "true" : undefined} onClick={() => { api?.scrollTo(i); api?.plugins().autoplay?.reset(); }} />)}</div>
      </section>
      <section className="guan-product-landing-actions" aria-labelledby="guan-home-products"><h2 id="guan-home-products">暂无产品</h2><p>新建、导入产品，或从产品回收站恢复，开始使用画布。</p><div className="guan-product-landing-buttons"><button type="button" data-empty-action="new" onClick={onCreate}>新建产品</button><button type="button" data-empty-action="import" disabled={busy} title={pending} onClick={() => importRef.current?.click()}>导入产品</button><input ref={importRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImportProduct(file); event.currentTarget.value = ""; }} /><ProductTrashEntry variant="text" /></div></section>
    </div>
  </main>;
}
