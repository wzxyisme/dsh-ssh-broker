export const commandName = 'ssh-broker'
export const toolNames = Object.freeze({
  exec: 'dsh_ssh_broker_exec',
  list: 'dsh_ssh_broker_list',
  upload: 'dsh_ssh_broker_upload',
  download: 'dsh_ssh_broker_download',
  verify: 'dsh_ssh_broker_verify',
  replace: 'dsh_ssh_broker_replace',
})

const usage = '请在 /ssh-broker 后填写任务。'
const unavailable = '当前会话没有有效的 SSH 授权。请在「设置 → SSH 设备」核对凭据库状态，并为当前会话授权。'
const selectedUnavailable = '所选 SSH 设备的授权已失效。请重新授权或选择另一台设备后再提交。'
const prefix = /^--device ([0-9a-f]{32}) --(?:\s+|$)/

export function composeSshTask(rawInput, choices) {
  let text = rawInput.trim()
  const selector = prefix.exec(text)
  if (/^--device(?:\s|$)/.test(text) && !selector) {
    return { error: 'SSH 设备选择格式有误。请使用输入框上方的设备选择器。' }
  }
  if (selector) text = text.slice(selector[0].length).trim()
  if (!text) return { error: usage }
  if (!selector && choices.length > 1) return { error: '当前会话有多台已授权设备。请在输入框上方选择设备后再提交。' }
  const choice = selector ? choices.find(({ selection }) => selection === selector[1]) : choices[0]
  if (!choice) return { error: selector ? selectedUnavailable : unavailable }
  const allowedTools = []
  if (choice.shell) allowedTools.push(toolNames.exec)
  if (choice.transfer) allowedTools.push(toolNames.list, toolNames.upload, toolNames.download, toolNames.verify, toolNames.replace)
  return {
    label: choice.label,
    text: `${text}\n\n[SSH Broker · 本次任务的设备授权]\n只在用户明确请求的范围内使用以下工具执行本次任务。调用时将 session 设置为 ${choice.grantId}。可用工具：${allowedTools.join('、')}。授权失效、权限不足或设备不匹配时，请向用户报告，等待重新授权。`,
  }
}
