import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';

const jsx = (type, props) => ({ type, props });
const elements = tree => Array.isArray(tree) ? tree.flatMap(elements) : tree && typeof tree === 'object'
    ? [tree, ...elements(tree.props?.children)] : [];
function hooks() {
    const slots = []; let index = 0;
    return { render: fn => { index = 0; return fn(); }, react: {
        useState: value => { const key = index++; if (!(key in slots)) slots[key] = value;
            return [slots[key], next => { slots[key] = typeof next === 'function' ? next(slots[key]) : next; }]; },
        useRef: current => { const key = index++; return slots[key] ??= { current }; },
        useEffect() {}, useId: () => 'picker',
    } };
}

test('模型选项继承所属模态层级；空音频选项即使带旧回调仍进入统一配置引导', () => {
    const runtime = hooks(), notices = [], legacy = [];
    let options = ['configured-image'];
    const loader = variantModules({
        react: runtime.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
        'react-i18next': { useTranslation: () => ({ t: key => key }) },
        'lucide-react': { Cpu: 'Cpu', Repeat2: 'Repeat2' },
        '@/扩展功能/故障切换/浏览器状态': { useFallbackRevision() {} },
        '@/扩展功能/产品配置/模型配置门禁': { showMissingModelConfiguration: capability => notices.push(capability) },
        '@/扩展功能/画布生成/文本模型推理菜单': { TextModelReasoningMenu: 'ReasoningMenu' },
        '@/components/ui/select': { Select: 'Select', SelectContent: 'Content', SelectItem: 'Item', SelectTrigger: 'Trigger' },
        '@/lib/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') },
        '@/stores/use-config-store': { FALLBACK_MODEL_OPTION: 'fallback', hasEnabledFallback: () => false,
            modelOptionLabel: (_config, value) => value, modelOptionName: value => value, selectableModelsByCapability: () => options },
    });
    const { ModelPicker } = loader.load('components/model-picker.tsx', true);
    const args = { config: { channelMode: 'channels', models: [] }, capability: 'image', onChange() {}, onMissingConfig: () => legacy.push('old-tab') };
    const render = () => runtime.render(() => ModelPicker(args));
    let tree = render();
    const trigger = elements(tree).find(item => item.type === 'Trigger');
    trigger.props.ref.current = { closest: () => ({}) };
    const original = globalThis.getComputedStyle;
    const oldWindow = globalThis.window;
    try {
        globalThis.window = { dispatchEvent() {} };
        globalThis.getComputedStyle = () => ({ zIndex: '1700' });
        tree.props.onOpenChange(true); tree = render();
        assert.equal(elements(tree).find(item => item.type === 'Content').props.style.zIndex, 1710);
        options = []; args.capability = 'audio';
        tree = render(); tree.props.onOpenChange(true);
        assert.deepEqual(legacy, ['old-tab']);
        assert.deepEqual(notices, ['audio']);
        assert.equal(render().props.open, false);
    } finally {
        if (original === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = original;
        if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    }
});

test('提示词卡点击只打开详情，关闭和复制不应用，显式应用才写入并关闭列表', () => {
    const runtime = hooks(), applied = [], opened = [], copied = [];
    const prompt = { id: 'sample', title: '测试提示词', prompt: '原始提示词', tags: [], referenceImageUrls: [] };
    const loader = variantModules({
        react: runtime.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
        antd: { App: { useApp: () => ({ message: {} }) }, Empty: 'Empty', Input: 'Input', Spin: 'Spin', Tag: { CheckableTag: 'Tag' } },
        'lucide-react': { Search: 'Search' }, 'react-i18next': { useTranslation: () => ({ t: key => key }) },
        '@/services/api/prompts': { ALL_PROMPTS_OPTION: '全部' },
        '@/扩展功能/主题/苹果弹窗': { AppleModal: 'Modal' },
        '@/扩展功能/主题/页签内容过渡': { TabContentTransition: 'Transition' },
        '@/hooks/use-copy-text': { useCopyText: () => text => copied.push(text) },
        '@/pages/prompts/components/prompt-detail-dialog': { PromptDetailDialog: 'Detail' },
        '@/lib/utils': { cn: (...values) => values.join(' ') },
        './prompt-card': { PromptCard: 'Card' },
        './use-prompt-list': { usePromptList: () => ({ query: { data: { pages: [{ items: [prompt] }] } },
            items: [prompt], tags: [], categories: [] }) },
    });
    const { PromptSelectDialog } = loader.load('components/prompts/prompt-select-dialog.tsx', true);
    const render = () => runtime.render(() => PromptSelectDialog({ open: true, onSelect: text => applied.push(text), onOpenChange: value => opened.push(value) }));
    let tree = render();
    assert.equal(tree.props.children[0].type, 'Modal');
    assert.equal(tree.props.children[1].type, 'Detail', '详情Portal不能冻结在父窗口的退出快照中');
    elements(tree).find(item => item.type === 'Card').props.onOpen();
    tree = render(); let detail = elements(tree).find(item => item.type === 'Detail');
    assert.equal(detail.props.prompt, prompt); assert.deepEqual(applied, []); assert.deepEqual(opened, []);
    detail.props.onCopy(prompt.prompt); assert.deepEqual(copied, [prompt.prompt]); assert.deepEqual(applied, []);
    detail.props.onClose(); assert.equal(elements(render()).find(item => item.type === 'Detail').props.prompt, null);
    elements(render()).find(item => item.type === 'Card').props.onOpen();
    detail = elements(render()).find(item => item.type === 'Detail');
    detail.props.onApply(prompt); assert.deepEqual(applied, [prompt.prompt]); assert.deepEqual(opened, [false]);
});
