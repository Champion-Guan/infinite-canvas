export type InterfaceDiagnostic = {
    code: string;
    version: string;
    time: string;
};

export function interfaceDiagnostic(error: unknown, version: string, time = new Date().toISOString()): InterfaceDiagnostic {
    const message = error instanceof Error ? error.message : "";
    const code = /Minified React error #185\b|Maximum update depth exceeded/i.test(message)
        ? "UI-185"
        : /dynamically imported module|Loading chunk|ChunkLoadError/i.test(message)
            ? "UI-RESOURCE"
            : "UI-UNEXPECTED";
    // 诊断仅保留类别和版本，不复制可能夹带提示词、密钥或本机路径的原始异常。
    return { code, version: /^[\w.+-]{1,64}$/.test(version) ? version : "unknown", time };
}

export function diagnosticText(value: InterfaceDiagnostic) {
    return `工作台界面诊断\n编号：${value.code}\n版本：${value.version}\n时间：${value.time}`;
}
