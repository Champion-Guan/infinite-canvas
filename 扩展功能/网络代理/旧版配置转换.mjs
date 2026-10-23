// 来源：旧项目 src/server/proxy-service.mjs；保留原配置转换算法。安全限制在调用边界执行。
function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function decodeFragment(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function uniqueName(preferred, index, used) {
  const base = String(preferred || `image-relay-${index + 1}`).trim() || `image-relay-${index + 1}`;
  let name = base;
  let suffix = 2;
  while (used.has(name)) name = `${base}-${suffix++}`;
  used.add(name);
  return name;
}

function parseSsNode(line, index, used) {
  const source = line.trim();
  if (!/^ss:\/\//i.test(source)) return null;
  let url;
  try {
    url = new URL(source);
  } catch {
    return null;
  }

  let method = decodeFragment(url.username);
  let password = decodeFragment(url.password);
  let server = url.hostname;
  let port = Number(url.port || 0);
  if (!server || !port || !method || !password) {
    const encoded = source.slice(source.indexOf("://") + 3).split(/[?#]/, 1)[0];
    let decoded;
    try {
      decoded = decodeBase64Url(encoded);
    } catch {
      decoded = "";
    }
    const at = decoded.lastIndexOf("@");
    const credentials = at >= 0 ? decoded.slice(0, at) : "";
    const address = at >= 0 ? decoded.slice(at + 1) : decoded;
    const separator = credentials.indexOf(":");
    if (separator > 0) {
      method = method || credentials.slice(0, separator);
      password = password || credentials.slice(separator + 1);
    }
    const colon = address.lastIndexOf(":");
    if (colon > 0) {
      server = server || address.slice(0, colon);
      port = port || Number(address.slice(colon + 1));
    }
  }
  if (!server || !port || !method || !password) return null;

  const node = {
    name: uniqueName(decodeFragment(url.hash.slice(1)), index, used),
    type: "ss",
    server,
    port,
    cipher: method,
    password,
  };
  const plugin = url.searchParams.get("plugin");
  if (plugin) node.plugin = plugin;
  return node;
}

function parseHysteriaNode(line, index, used) {
  const source = line.trim().replace(/^hy2:\/\//i, "hysteria2://");
  if (!/^hysteria2:\/\//i.test(source)) return null;
  let url;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  const server = url.hostname;
  const port = Number(url.port || 0);
  const password = decodeFragment(url.username || url.password);
  if (!server || !port || !password) return null;

  const node = {
    name: uniqueName(decodeFragment(url.hash.slice(1)), index, used),
    type: "hysteria2",
    server,
    port,
    password,
  };
  const sni = url.searchParams.get("sni") || url.searchParams.get("peer");
  if (sni) node.sni = sni;
  if (["1", "true", "yes"].includes((url.searchParams.get("insecure") || "").toLowerCase())) {
    node["skip-cert-verify"] = true;
  }
  const obfs = url.searchParams.get("obfs");
  const obfsPassword = url.searchParams.get("obfs-password") || url.searchParams.get("obfs_password");
  if (obfs) {
    node.obfs = obfs;
    if (obfsPassword) node["obfs-password"] = obfsPassword;
  }
  const alpn = url.searchParams.getAll("alpn");
  if (alpn.length) node.alpn = alpn;
  return node;
}

function parseSubscriptionNodes(source) {
  let text = String(source || "").replace(/^\uFEFF/, "").trim();
  if (!text) return [];
  if (!/^proxies\s*:/m.test(text) && !/^[a-z][a-z\d+.-]*:\/\//im.test(text)) {
    try {
      const decoded = decodeBase64Url(text.replace(/\s+/g, ""));
      if (/[a-z][a-z\d+.-]*:\/\//i.test(decoded)) text = decoded;
    } catch {
      // Leave malformed/unsupported subscription data for the diagnostic below.
    }
  }

  if (/^proxies\s*:/m.test(text)) return null;
  const used = new Set();
  const nodes = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) continue;
    const node = parseSsNode(clean, index, used) || parseHysteriaNode(clean, index, used);
    if (node) nodes.push(node);
  }
  return nodes;
}

function nodeYaml(node) {
  const lines = [
    `  - name: ${yamlString(node.name)}`,
    `    type: ${node.type}`,
    `    server: ${yamlString(node.server)}`,
    `    port: ${node.port}`,
  ];
  if (node.type === "ss") {
    lines.push(`    cipher: ${yamlString(node.cipher)}`);
    lines.push(`    password: ${yamlString(node.password)}`);
    if (node.plugin) lines.push(`    plugin: ${yamlString(node.plugin)}`);
  } else {
    lines.push(`    password: ${yamlString(node.password)}`);
    if (node.sni) lines.push(`    sni: ${yamlString(node.sni)}`);
    if (node["skip-cert-verify"]) lines.push("    skip-cert-verify: true");
    if (node.obfs) lines.push(`    obfs: ${yamlString(node.obfs)}`);
    if (node["obfs-password"]) lines.push(`    obfs-password: ${yamlString(node["obfs-password"])}`);
    if (node.alpn?.length) lines.push(`    alpn: ${JSON.stringify(node.alpn)}`);
  }
  return lines.join("\n");
}

export function buildMihomoConfig(source, port) {
  const nodes = parseSubscriptionNodes(source);
  if (nodes === null) {
    // A complete Clash/Mihomo document can be supplied through a local file
    // or a private subscription URL. Existing routing is preserved;
    // node credentials stay in the temporary runtime file.
    let config = String(source).replace(/^\uFEFF/, "");
    // Mihomo removed the global-client-fingerprint option. Older Clash
    // exports may still contain it; per-proxy client-fingerprint values are
    // retained, so remove only this obsolete top-level setting.
    config = config.replace(/^global-client-fingerprint\s*:\s*[^\n]*\n?/gim, "");
    // Do not block the local listener on downloading GeoIP/GeoSite assets.
    // The relay only needs an HTTP mixed port; remote rule providers remain
    // available to Mihomo after startup when the user's config references them.
    config = config.replace(/^geodata-mode\s*:\s*[^\n]*\n?/gim, "geodata-mode: false\n");
    config = config.replace(/^geox-url:\s*\n(?:^[ \t]+[^\n]*\n?)*/gim, "");
    config = config.replace(/^[ \t]*-[ \t]*GEOSITE,[^\n]*\n?/gim, "  - MATCH,DIRECT\n");
    const replacements = [
      ["mixed-port", String(port)],
      ["port", "0"],
      ["socks-port", "0"],
      ["redir-port", "0"],
      ["tproxy-port", "0"],
      ["external-controller", '""'],
    ];
    for (const [key, value] of replacements) {
      const expression = new RegExp(`^${key}\\s*:[^\\n]*$`, "mi");
      if (expression.test(config)) config = config.replace(expression, `${key}: ${value}`);
      else config = `${key}: ${value}\n${config}`;
    }
    // A provider export may contain only proxies, not a runnable routing
    // policy. Rule mode without rules silently sends every request DIRECT.
    const rulesSection = config.match(/^rules\s*:([^\n]*)(?:\n((?:[ \t]+[^\n]*\n?|\s*\n|#[^\n]*\n)*))?/m);
    const rulesBody = rulesSection
      ? `${rulesSection[1]}\n${rulesSection[2] || ""}`.replace(/#[^\n]*/g, "").trim()
      : "";
    if (!rulesBody || rulesBody === "[]" || rulesBody === "null" || rulesBody === "~") {
      const groupName = "WORKBENCH-IMAGE-RELAY";
      const group = [
        `  - name: ${groupName}`,
        "    type: url-test",
        "    include-all-proxies: true",
        "    exclude-type: direct|reject|pass",
        "    url: https://www.gstatic.com/generate_204",
        "    interval: 300",
        "    tolerance: 0",
        "    lazy: false",
      ].join("\n");
      // Do not parse/re-serialize node credentials. Mihomo includes the
      // configured outbound nodes itself, including flow-style YAML nodes.
      const groupsHeader = /^proxy-groups\s*:([^\n]*)$/m;
      const groups = config.match(groupsHeader);
      if (groups && !/^(?:\s*|\s*\[\]\s*|\s*null\s*|\s*~\s*)(?:#.*)?$/.test(groups[1])) {
        throw new Error("代理配置缺少路由规则，请为已有内联代理组配置 rules");
      }
      if (groups) config = config.replace(groupsHeader, `proxy-groups:\n${group}`);
      else config += `\nproxy-groups:\n${group}\n`;
      if (rulesSection) config = config.replace(rulesSection[0], "");
      config += `\nrules:\n  - MATCH,${groupName}\n`;
      if (/^mode\s*:/mi.test(config)) config = config.replace(/^mode\s*:[^\n]*$/mi, "mode: rule");
      else config = `mode: rule\n${config}`;
    }
    return config.endsWith("\n") ? config : `${config}\n`;
  }
  if (!nodes.length) throw new Error("未找到可用的 SS 或 Hysteria2 节点");
  const names = nodes.map((node) => node.name);
  return [
    `mixed-port: ${port}`,
    "allow-lan: false",
    "mode: rule",
    "log-level: warning",
    "ipv6: true",
    "proxies:",
    ...nodes.map(nodeYaml),
    "proxy-groups:",
    "  - name: IMAGE-RELAY",
    "    type: url-test",
    "    url: https://www.gstatic.com/generate_204",
    "    interval: 300",
    "    tolerance: 0",
    "    lazy: false",
    "    proxies:",
    ...names.map((name) => `      - ${yamlString(name)}`),
    "rules:",
    "  - MATCH,IMAGE-RELAY",
    "",
  ].join("\n");
}
