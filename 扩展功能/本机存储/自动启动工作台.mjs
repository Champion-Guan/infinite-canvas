import { mountAutomaticWorkbench } from './工作台自动入口.mjs';

// 自有入口后继候选；不改原作者HTML/main/React布局。具体装配仍须审查。
mountAutomaticWorkbench({ root: document.getElementById('root') });
