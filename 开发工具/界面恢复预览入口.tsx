import { hydrateRoot } from "react-dom/client";
import { InterfaceRecoveryView } from "../扩展功能/存储界面/界面异常恢复";
import type { InterfaceDiagnostic } from "../扩展功能/存储界面/界面异常说明";

declare const __RECOVERY_PREVIEW__: { diagnostic: InterfaceDiagnostic; workbenchUrl: string; notice: string };

const root = document.getElementById("interface-recovery-preview");
if (root) hydrateRoot(root, <InterfaceRecoveryView diagnostic={__RECOVERY_PREVIEW__.diagnostic}
    retryHref={__RECOVERY_PREVIEW__.workbenchUrl} previewNotice={__RECOVERY_PREVIEW__.notice}
    logoSrc={root.querySelector("img")?.getAttribute("src") || undefined} />);
