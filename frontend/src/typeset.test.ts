/**
 * typeset 排版层契约(v0.3.8)。
 *
 * typeset.css 是官方正典原文(零改动),本文件以文本契约锁住官方文档
 * 声明的核心机制,防止误删改;preset 与挂载关系(style.css 侧)同测。
 * 官方文档:https://ui.shadcn.com/docs/typeset
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = join(__dirname, '.');
const typeset = readFileSync(join(srcDir, 'typeset.css'), 'utf-8');
const style = readFileSync(join(srcDir, 'style.css'), 'utf-8');

/** 剥掉块注释后做机制断言:只看规则正文,注释里引用选择器名不算。 */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const typesetRules = stripComments(typeset);

describe('typeset.css 官方正典机制', () => {
  it('基础块声明三旋钮默认值(size/leading/flow)', () => {
    expect(typeset).toContain('--typeset-size: 1em');
    expect(typeset).toContain('--typeset-leading: 1.75');
    expect(typeset).toContain('--typeset-flow: 1.25em');
  });

  it('规则经 :where() 零优先级包裹并置于 components 层', () => {
    expect(typeset).toContain('@layer components');
    expect(typeset).toContain(':where(');
  });

  it('块间距只用单向 margin-block-start(流式追加不重排旧块)', () => {
    expect(typeset).toContain('margin-block-start');
    // 无反向间距:不出现 margin-block-end 正值(官方原文仅 margin-block-end: 0)
    expect(typeset).not.toMatch(/margin-block-end:\s*(?!0)[0-9.]/);
  });

  it('布局规则无前瞻选择器(流式稳定承诺)', () => {
    expect(typesetRules).not.toContain(':last-child');
    expect(typesetRules).not.toContain(':empty');
    expect(typesetRules).not.toContain(':has(');
  });

  it('表格分隔线定义在 cell 上而非行尾(append-safe)', () => {
    expect(typeset).toContain('border-block-start: 1px solid var(--typeset-rule)');
  });

  it('not-typeset 类与 data-not-typeset 属性双逃生门', () => {
    expect(typeset).toContain('.not-typeset');
    expect(typeset).toContain('[data-not-typeset]');
  });

  it('typeset-scroll 宽块横滚包裹(包装器持有 flow margin)', () => {
    expect(typeset).toContain('.typeset-scroll');
  });
});

describe('style.css 挂载与 preset(应用定制层)', () => {
  it('于 tailwindcss 之后 @import typeset.css', () => {
    const importIdx = style.indexOf("@import 'tailwindcss'");
    const typesetIdx = style.indexOf("@import './typeset.css'");
    expect(typesetIdx).toBeGreaterThan(importIdx);
  });

  it('字体 token 单源:--font-heading / --font-mono 供 typeset 旋钮消费', () => {
    expect(style).toContain('--font-heading: var(--font-sans)');
    expect(style).toContain('--font-mono:');
  });

  it('typeset-docs preset 对齐官方文档节奏(15px / 1.75 / 1.25em)', () => {
    expect(style).toMatch(/\.typeset-docs\s*{[^}]*--typeset-size: 15px/s);
    expect(style).toMatch(/\.typeset-docs\s*{[^}]*--typeset-leading: 1\.75/s);
    expect(style).toMatch(/\.typeset-docs\s*{[^}]*--typeset-flow: 1\.25em/s);
  });

  it('typeset-chat preset 对齐官方聊天节奏(1.6 / 1em)', () => {
    expect(style).toMatch(/\.typeset-chat\s*{[^}]*--typeset-leading: 1\.6/s);
    expect(style).toMatch(/\.typeset-chat\s*{[^}]*--typeset-flow: 1em/s);
  });

  it('body 字体走 var(--font-sans) 单源', () => {
    expect(style).toContain('font-family: var(--font-sans)');
  });
});
