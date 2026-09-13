// scripts/notify/channels/index.mjs — 通知渠道 Registry（type → adapter）
// 对应 IMPLEMENTATION_PLAN T-P3-07
// 与 scripts/collect/connectors/registry.mjs 同风格：register / get / listTypes / _reset。
//
// 适配器统一接口：{ type, requiredRefs(channel), send({channel, message, env, fetchImpl, transportFactory}) }
// 4 个渠道在模块加载时自注册（email / feishu / dingtalk / wecom）。

import * as email from './email.mjs';
import * as feishu from './feishu.mjs';
import * as dingtalk from './dingtalk.mjs';
import * as wecom from './wecom.mjs';

const registry = new Map();

/**
 * 注册一个渠道适配器。
 * @param {string} type
 * @param {{type:string, send:Function}} adapter
 */
export function register(type, adapter) {
  if (registry.has(type)) throw new Error(`notify channelType "${type}" already registered`);
  if (!adapter || typeof adapter.send !== 'function') {
    throw new Error(`adapter for "${type}" must implement send()`);
  }
  registry.set(type, adapter);
}

/**
 * 获取渠道适配器；不存在抛错。
 * @param {string} type
 * @returns {{type:string, requiredRefs:Function, send:Function}}
 */
export function get(type) {
  const a = registry.get(type);
  if (!a) throw new Error(`unknown notify channelType "${type}"`);
  return a;
}

/** @param {string} type @returns {boolean} */
export function has(type) {
  return registry.has(type);
}

/** @returns {string[]} 已注册的 channelType（升序） */
export function listTypes() {
  return Array.from(registry.keys()).sort();
}

/** 重置（仅供测试用） */
export function _reset() {
  registry.clear();
}

// —— 自注册 4 个渠道 ——
register(email.type, email);
register(feishu.type, feishu);
register(dingtalk.type, dingtalk);
register(wecom.type, wecom);
