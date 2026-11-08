const nameOrder = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export function sortGenerationHistory(nodes) {
    return nodes.map((node, index) => {
        const name = String(node.title || "").trim().replace(/^[·\s]+/, "");
        const suffix = name.match(/[-－]\s*(\d+)$/);
        return { node, index, name: suffix ? name.slice(0, suffix.index).trim() : name, sequence: suffix?.[1] || "1" };
    })
        .sort((a, b) => nameOrder.compare(a.sequence, b.sequence) || nameOrder.compare(a.name, b.name) || a.index - b.index)
        .map(item => item.node);
}
