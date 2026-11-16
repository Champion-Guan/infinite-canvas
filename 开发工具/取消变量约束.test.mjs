import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';

test('实际图片编辑面板去除旧自动后缀，提交只含用户原文，不回写历史任务；生成中不发起新任务', () => {
    const oldPrompt = '更改一下图片的尺寸\n\n【变量与画面约束】\n本卡为产品尺寸展示主题，也只能标注本提示词中已填写的尺寸；缺少长度等参数时省略该尺寸标注，不用其他尺寸代替。';
    const node = { id: 'image', type: 'image', metadata: { content: 'blob:original', prompt: oldPrompt } };
    const original = structuredClone(node), submitted = [], writes = [];
    const element = (type, props) => ({ type, props });
    const ui = {
        'react/jsx-runtime': { jsx: element, jsxs: element },
        react: { useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useId: () => 'editor', useEffect() {} },
        '@/扩展功能/产品/产品界面边界': { useProductActive: () => true },
        '@/扩展功能/画布生成/文本推理强度': { normalizeTextReasoningEffort: value => value },
        '@/扩展功能/产品配置/精简与离线策略': { isGenerationModeEnabled: () => true },
        '@/扩展功能/主题/页签内容过渡': { TabContentTransition: 'TabContentTransition' },
        'lucide-react': { ArrowUp: 'ArrowUp', LoaderCircle: 'LoaderCircle', Maximize2: 'Maximize2', Square: 'Square' },
        antd: { Button: 'Button' },
        '@/扩展功能/主题/原生可关闭浮层': { OutsideTooltip: 'Tooltip' },
        '@/扩展功能/主题/苹果弹窗': { AppleModal: 'Modal' },
        'react-i18next': { useTranslation: () => ({ t: text => text }) },
        '@/components/model-picker': { ModelPicker: 'ModelPicker' },
        '@/stores/use-config-store': {
            useConfigStore: selector => selector({ openConfigDialog() {} }), useEffectiveConfig: () => ({ model: 'configured' }),
            defaultConfig: { count: '1' }, resolveModelForCapability: () => 'configured',
        },
        '@/lib/canvas-theme': { canvasThemes: { light: { toolbar: {}, node: {} } } },
        '@/stores/use-theme-store': { useThemeStore: selector => selector({ theme: 'light' }) },
    };
    for (const [path, name] of [
        ['canvas-image-settings-popover', 'CanvasImageSettingsPopover'], ['canvas-prompt-library', 'CanvasPromptLibrary'],
        ['canvas-audio-settings-popover', 'CanvasAudioSettingsPopover'], ['canvas-prompt-chip-input', 'CanvasPromptChipInput'],
        ['canvas-video-settings-popover', 'CanvasVideoSettingsPopover'], ['canvas-text-settings-popover', 'CanvasTextSettingsPopover'],
        ['canvas-node-reference-bar', 'CanvasNodeReferenceBar'],
    ]) ui['./' + path] = { [name]: name };
    const { CanvasNodePromptPanel } = variantModules(ui).load('components/canvas/canvas-node-prompt-panel.tsx', true);
    for (const isRunning of [false, true]) {
        const tree = CanvasNodePromptPanel({ node, nodes: [node], isRunning,
            onPromptChange: (...args) => writes.push(args), onConfigChange: (...args) => writes.push(args),
            onGenerate: (...args) => submitted.push(args), onStop() {} });
        const chips = [];
        const visit = item => {
            if (Array.isArray(item)) return item.forEach(visit);
            if (!item || typeof item !== 'object') return;
            if (item.type === 'CanvasPromptChipInput') chips.push(item);
            visit(item.props?.children);
        };
        visit(tree);
        assert.equal(chips.length, 2);
        chips.forEach(chip => assert.equal(chip.props.value, '更改一下图片的尺寸'));
        chips[0].props.onSubmit();
    }
    assert.deepEqual(submitted, [['image', 'image', '更改一下图片的尺寸']]);
    assert.deepEqual(writes, []); assert.deepEqual(node, original);
});
