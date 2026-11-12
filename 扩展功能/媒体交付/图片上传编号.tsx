export function ImageUploadNumber({ number }: { number?: number }) {
    if (!number) return null;
    return <span aria-label={`参考图 ${number}`} data-image-upload-number={number}
        className="pointer-events-none absolute left-1 top-1 z-[2] grid h-5 min-w-5 place-items-center rounded bg-black/75 px-1 text-[10px] font-semibold leading-none text-white shadow-sm"
        style={{ color: "#fff", fontSize: 10 }}>{number}</span>;
}
