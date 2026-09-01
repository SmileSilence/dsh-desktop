'use strict';

/**
 * 系统通知（B7 / P3.1）。
 * 封装 Electron Notification；接 POST /api/notify。副作用（Notification）由 deps 注入。
 */

/**
 * @param {{ Notification?: Function, logger?:{log?:Function} }} deps
 * @returns {{ notify:(body:{title:string, body?:string, urgency?:string})=>{delivered:boolean} }}
 */
function createNotifier(deps) {
  const { Notification, logger = {} } = deps;

  /**
   * 发送系统通知
   * @param {{title:string, body?:string, urgency?:string}} body
   * @returns {{delivered:boolean}}
   * @throws {Error} 平台不支持 / 无通知权限时抛错（桥返回 503）
   */
  function notify(body) {
    if (typeof Notification !== 'function') {
      throw new Error('当前平台不支持系统通知');
    }
    const title = String(body.title || 'DSH Desktop');
    const text = String(body.body || '');
    logger.log?.(`通知: ${title}${text ? ' - ' + text : ''}`);
    const n = new Notification({
      title,
      body: text,
      urgency: body.urgency || 'normal'
    });
    n.show();
    return { delivered: true };
  }

  return { notify };
}

module.exports = { createNotifier };
